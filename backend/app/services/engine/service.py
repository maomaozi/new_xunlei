"""Supervises the bundled Xunlei engine and exposes its download features.

The engine (`xunlei-pan-cli -q run runner`) embeds xldownloadlib (P2SP/BT/magnet/ed2k with
VIP acceleration) and a task runner that executes cloud tasks targeted at its device space.
Downloads are therefore created as cloud tasks (`POST /drive/v1/task`, `params.target` =
`device_id#<id>`); the engine receives them over MQTT, downloads to its folders and reports
progress back into the task (`params.speed`, `real_path`, `error`, ...). Pause/resume is a
`spec` phase patch, which the engine applies within a second.

The engine signs in with its own QR login so its refresh-token chain stays independent of
this app's (Xunlei rotates refresh tokens, two holders of one chain would log each other out).
"""

import asyncio
import contextlib
import json
import logging
import re
import shutil
import time
from pathlib import Path
from typing import Literal

from app.core.config import BACKEND_DIR
from app.core.errors import AppError
from app.schemas.engine import (
    DownloadCreateResponse,
    DownloadCreateResult,
    DownloadFilter,
    DownloadList,
    DownloadSummary,
    DownloadTask,
    EngineDisk,
    EngineFolder,
    EngineFolderList,
    EngineLoginStatus,
    EngineLogs,
    EngineState,
    EngineStatus,
    EngineUser,
    ForeignEngine,
    LiveDownloads,
    LiveTask,
    SpeedupState,
    TrialInfo,
)
from app.schemas.settings import AppSettings, EngineSettings
from app.schemas.xunlei import DriveTask
from app.services.engine.client import EngineClient, JsonObject
from app.services.engine.launcher import LauncherServer
from app.services.engine.process import (
    EngineProcess,
    LaunchSpec,
    binary_version,
    find_binary,
    foreign_engines,
    rotate_log,
    tail_log,
)
from app.services.settings_store import SettingsStore
from app.services.xunlei.api import XunleiApi
from app.services.xunlei.links import guess_name

logger = logging.getLogger(__name__)

ENGINE_TYPES = ("user#download-url", "user#download")
ENGINE_PHASES = (
    "PHASE_TYPE_PENDING,PHASE_TYPE_RUNNING,PHASE_TYPE_PAUSED,PHASE_TYPE_ERROR,PHASE_TYPE_COMPLETE"
)
DownloadStatus = Literal["queued", "running", "paused", "complete", "error"]
STATUS_BY_PHASE: dict[str, DownloadStatus] = {
    "PHASE_TYPE_PENDING": "queued",
    "PHASE_TYPE_RUNNING": "running",
    "PHASE_TYPE_PAUSED": "paused",
    "PHASE_TYPE_COMPLETE": "complete",
    "PHASE_TYPE_ERROR": "error",
}
FILTER_PHASES: dict[DownloadFilter, str] = {
    "all": ENGINE_PHASES,
    "active": "PHASE_TYPE_PENDING,PHASE_TYPE_RUNNING",
    "paused": "PHASE_TYPE_PAUSED",
    "complete": "PHASE_TYPE_COMPLETE",
    "error": "PHASE_TYPE_ERROR",
}
FILTER_STATUSES: dict[DownloadFilter, tuple[DownloadStatus, ...]] = {
    "all": ("queued", "running", "paused", "complete", "error"),
    "active": ("queued", "running"),
    "paused": ("paused",),
    "complete": ("complete",),
    "error": ("error",),
}
WATCH_INTERVAL = 3.0
SNAPSHOT_TTL = 12.0
MAX_TASK_PAGES = 10
SUMMARY_TTL = 20.0
LIVE_TTL = 0.4
VIP_GROUP = re.compile(r"^vip_\d+_(\d+)_")


def _int(value: object) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


def _json(value: str) -> JsonObject:
    try:
        data = json.loads(value) if value else {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _make_dirs(dirs: list[Path]) -> None:
    for directory in dirs:
        directory.mkdir(parents=True, exist_ok=True)


def remove_inside(paths: list[Path], roots: list[Path]) -> int:
    """Delete files/folders that lie strictly inside one of `roots`; others are skipped."""
    bases = [root.resolve() for root in roots]
    removed = 0
    for path in paths:
        target = path.resolve()
        if not any(target != base and target.is_relative_to(base) for base in bases):
            logger.info("Not deleting %s: outside the engine download folders", path)
            continue
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target, ignore_errors=True)
        else:
            target.unlink(missing_ok=True)
        removed += 1
    return removed


def parse_indexes(raw: str) -> list[int]:
    """`"0-2,5"` -> `[0, 1, 2, 5]` (inverse of `compress_indexes`)."""
    indexes: list[int] = []
    for part in raw.split(","):
        start, _, end = part.strip().partition("-")
        if start.isdigit():
            last = int(end) if end.isdigit() else int(start)
            indexes.extend(range(int(start), last + 1))
    return indexes


def to_download(task: DriveTask) -> DownloadTask:
    params = task.params
    status = STATUS_BY_PHASE.get(task.phase, "queued")
    speedup = _json(params.get("speedup", ""))
    size = task.file_size
    progress = 100 if status == "complete" else max(0, min(100, task.progress))
    error = params.get("error", "")
    if status == "error" and not error:
        error = task.message
    return DownloadTask(
        id=task.id,
        name=task.name or task.file_name,
        source="cloud" if task.type == "user#download" else "link",
        phase=task.phase,
        status=status,
        message=task.message,
        error=error,
        progress=progress,
        size=size,
        done_bytes=size * progress // 100,
        speed=_int(params.get("speed")) if status == "running" else 0,
        speedup_speed=_int(params.get("speedup_speed")) if status == "running" else 0,
        speedup=SpeedupState(
            p2p=str(speedup.get("p2p") or ""),
            vip=str(speedup.get("vip") or ""),
            super=str(speedup.get("super") or ""),
        ),
        url=params.get("url", ""),
        cloud_file_id=params.get("file_id", ""),
        sub_files=params.get("sub_file_index", ""),
        local_path=params.get("real_path", ""),
        folder_id=params.get("parent_folder_id", ""),
        hash=params.get("hash", ""),
        icon=task.icon_link,
        created_at=task.created_time,
        updated_at=task.updated_time,
        params=dict(params),
    )


def parse_live(snapshot: JsonObject) -> LiveDownloads:
    """Tasks in the runner's memory (`Process`) with the kernel's per-second progress/speed."""
    running_ids = snapshot.get("Running") if isinstance(snapshot.get("Running"), dict) else {}
    assert isinstance(running_ids, dict)
    tasks: list[LiveTask] = []
    for item in snapshot.get("Process") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        params = item.get("params") if isinstance(item.get("params"), dict) else {}
        assert isinstance(params, dict)
        status = STATUS_BY_PHASE.get(str(item.get("phase") or ""), "queued")
        running = bool(running_ids.get(item["id"]))
        try:
            progress = max(0.0, min(100.0, float(item.get("progress") or 0)))
        except (TypeError, ValueError):
            progress = 0.0
        if status == "complete":
            progress = 100.0
        size = _int(item.get("file_size"))
        moving = running and status == "running"
        tasks.append(
            LiveTask(
                id=str(item["id"]),
                name=str(item.get("name") or item.get("file_name") or ""),
                status=status,
                running=running,
                progress=round(progress, 2),
                size=size,
                done_bytes=int(size * progress / 100),
                speed=_int(params.get("speed")) if moving else 0,
                speedup_speed=_int(params.get("speedup_speed")) if moving else 0,
                local_path=str(params.get("real_path") or ""),
            )
        )
    return LiveDownloads(
        tasks=tasks, running=sum(t.running for t in tasks), speed=sum(t.speed for t in tasks)
    )


def overlay(task: DownloadTask, live: LiveTask) -> DownloadTask:
    """Prefer the engine's in-memory values; the cloud copy is patched at most once a minute."""
    update: dict[str, object] = {
        "status": live.status,
        "progress": live.progress,
        "speed": live.speed,
        "speedup_speed": live.speedup_speed,
    }
    if live.size:
        update["size"] = live.size
        update["done_bytes"] = live.done_bytes
    if live.local_path and not task.local_path:
        update["local_path"] = live.local_path
    return task.model_copy(update=update)


def summarize(tasks: list[DownloadTask]) -> DownloadSummary:
    return DownloadSummary(
        total=len(tasks),
        active=sum(t.status in ("queued", "running") for t in tasks),
        paused=sum(t.status == "paused" for t in tasks),
        complete=sum(t.status == "complete" for t in tasks),
        error=sum(t.status == "error" for t in tasks),
        speed=sum(t.speed for t in tasks),
    )


def parse_user(snapshot: JsonObject) -> EngineUser:
    user = snapshot.get("user")
    if not isinstance(user, dict):
        return EngineUser()
    vip = user.get("vip") if isinstance(user.get("vip"), dict) else {}
    level = _int(vip.get("level")) if isinstance(vip, dict) else 0
    expires = ""
    for group in user.get("group") or []:
        match = VIP_GROUP.match(str(group.get("id", ""))) if isinstance(group, dict) else None
        if match:
            level = level or int(match.group(1))
            expires = str(group.get("expires_at") or "")
            break
    return EngineUser(
        id=str(user.get("id") or ""),
        name=str(user.get("name") or ""),
        avatar=str(user.get("picture") or ""),
        vip_level=level,
        vip_expires_at=expires,
    )


class EngineService:
    def __init__(
        self,
        settings: SettingsStore,
        api: XunleiApi,
        data_dir: Path,
        *,
        autostart: bool,
    ) -> None:
        self._settings = settings
        self.api = api
        self.data_dir = data_dir
        self.autostart = autostart
        self.process = EngineProcess()
        self.launcher = LauncherServer(version=api.config.account.client_version)
        self._client: EngineClient | None = None
        self._desired = False
        self._restarts = 0
        self._next_restart = 0.0
        self._message = ""
        self._snapshot: JsonObject = {}
        self._snapshot_at = 0.0
        self._running_tasks = 0
        self._applied: tuple[object, ...] | None = None
        self._summary: DownloadSummary | None = None
        self._summary_at = 0.0
        self._live: LiveDownloads | None = None
        self._live_at = 0.0
        self._live_lock = asyncio.Lock()
        self._lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._watchdog: asyncio.Task[None] | None = None
        self._enabled = settings.current.engine.enabled
        settings.subscribe(self._on_settings_changed)

    # ------------------------------------------------------------------ settings

    @property
    def config(self) -> EngineSettings:
        return self._settings.current.engine

    @property
    def home(self) -> Path:
        configured = self.config.home_dir.strip()
        return Path(configured).expanduser() if configured else self.data_dir / "engine"

    @property
    def download_dirs(self) -> list[Path]:
        dirs = [self.config.download_dir, *self.config.extra_download_dirs]
        unique = dict.fromkeys(Path(d).expanduser() for d in dirs if d.strip())
        return list(unique)

    def _search_dirs(self) -> list[Path]:
        # Bundled binaries live in <project>/engine; a custom one can go into <home>/bin.
        return [self.home / "bin", self.data_dir / "engine" / "bin", BACKEND_DIR.parent / "engine"]

    def binary(self) -> Path | None:
        return find_binary(self.config.binary_path, self._search_dirs())

    def spec(self) -> LaunchSpec:
        binary = self.binary()
        if binary is None:
            raise AppError("engine_binary_missing", 409)
        cfg = self.config
        creds = self.api.credentials
        torrent = cfg.torrent_dir.strip()
        return LaunchSpec(
            binary=binary,
            home=self.home,
            platform=cfg.platform,
            nas_id=cfg.nas_id,
            control_port=cfg.control_port,
            public_port=cfg.public_port,
            launcher_port=cfg.launcher_port,
            download_dir=self.download_dirs[0],
            torrent_dir=Path(torrent).expanduser() if torrent else self.home / "torrents",
            device_id=creds.device_id,
            user_id=creds.user_id,
            client_id=self.api.config.account.client_id,
            client_version=self.api.config.account.client_version,
            log_max_bytes=cfg.log_max_mb * 1024 * 1024,
        )

    def _on_settings_changed(self, value: AppSettings) -> None:
        enabled = value.engine.enabled
        if enabled and not self._enabled and self.autostart:
            self._desired = True
            self._next_restart = 0
        elif not enabled:
            self._desired = False
        self._enabled = enabled
        self._applied = None
        self._wake.set()

    @property
    def client(self) -> EngineClient:
        drive = self.home / ".drive"
        port = self.config.control_port
        if self._client is None or self._client.port != port or self._client.drive_dir != drive:
            if self._client is not None:
                old = self._client
                with contextlib.suppress(RuntimeError):
                    asyncio.get_running_loop().create_task(old.close())
            self._client = EngineClient(port, drive)
        return self._client

    # ----------------------------------------------------------------- lifecycle

    async def start_service(self) -> None:
        if not self.autostart:
            return
        if self.config.enabled:
            self._desired = True
            try:
                await self._launch()
            except AppError as error:
                self._message = error.message
            except OSError as error:
                self._message = f"下载引擎启动失败：{error}"
                logger.warning("Engine failed to start: %s", error)
        self._watchdog = asyncio.create_task(self._watch(), name="engine-watchdog")

    async def stop_service(self) -> None:
        if self._watchdog is not None:
            self._watchdog.cancel()
            await asyncio.gather(self._watchdog, return_exceptions=True)
        if self.config.stop_with_app:
            await self.process.stop()
        await self.launcher.stop()
        if self._client is not None:
            await self._client.close()

    async def _launch(self) -> None:
        spec = self.spec()
        await self.launcher.start(spec.launcher_port)
        if not self.process.alive and not self.process.adopt(spec):
            await self.process.start(spec)
        self._applied = None
        self._message = ""
        self._snapshot = {}
        self.client.forget_secret()

    async def start(self) -> None:
        if not self.config.enabled:
            raise AppError("invalid_request", 409, "下载引擎已在设置中停用。")
        async with self._lock:
            self._desired = True
            self._restarts = 0
            await self._launch()
        self._wake.set()

    async def stop(self) -> None:
        async with self._lock:
            self._desired = False
            await self.process.stop()
            self._snapshot = {}

    async def restart(self) -> None:
        async with self._lock:
            await self.process.stop()
            self._desired = True
            await self._launch()
        self._wake.set()

    async def _watch(self) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=WATCH_INTERVAL)
            self._wake.clear()
            try:
                async with self._lock:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Engine watchdog iteration failed")

    async def _tick(self) -> None:
        self.process.poll()
        cfg = self.config
        if not cfg.enabled or not self._desired:
            if self.process.alive and not cfg.enabled:
                await self.process.stop()
            return
        if not self.process.alive:
            if not cfg.auto_restart and self.process.started_at:
                return
            if time.monotonic() < self._next_restart:
                return
            delay = min(60.0, 5.0 * 2 ** min(self._restarts, 4))
            self._next_restart = time.monotonic() + delay
            if self.process.started_at:
                self._restarts += 1
            try:
                await self._launch()
            except (AppError, OSError) as error:
                self._message = error.message if isinstance(error, AppError) else str(error)
            return
        try:
            spec = self.spec()
        except AppError:
            spec = None
        if spec is not None and self.process.spec is not None and spec != self.process.spec:
            logger.info("Engine launch settings changed; restarting the engine")
            await self.process.stop()
            await self._launch()
            return
        await asyncio.to_thread(rotate_log, self.home / "engine.log", cfg.log_max_mb * 1024 * 1024)
        await self._refresh()
        if self._snapshot and self._applied != self._config_signature():
            await self._apply_config()

    async def _refresh(self) -> None:
        try:
            self._snapshot = await self.client.status()
            self._snapshot_at = time.monotonic()
            health = await self.client.healthz()
            self._running_tasks = _int(health.get("running_count"))
        except AppError:
            if time.monotonic() - self._snapshot_at > SNAPSHOT_TTL:
                self._snapshot = {}

    def _config_signature(self) -> tuple[object, ...]:
        cfg = self.config
        return (
            cfg.speed_limit_kbps,
            cfg.max_running_tasks,
            cfg.device_name,
            tuple(str(d) for d in self.download_dirs),
            cfg.single_task_max_mb,
            cfg.single_task_reserve_mb,
            cfg.overall_share_max_mb,
        )

    async def _apply_config(self) -> None:
        cfg = self.config
        signature = self._config_signature()
        dirs = self.download_dirs
        await asyncio.to_thread(_make_dirs, dirs)
        current = await self.client.local_config()
        current.update(
            {
                "custom_device_name": cfg.device_name,
                "speed_limit": cfg.speed_limit_kbps * 1024 if cfg.speed_limit_kbps else -1,
                "runner_count": cfg.max_running_tasks,
                "download_paths": [str(d).rstrip("/") + "/" for d in dirs],
                "single_task_max_mb": cfg.single_task_max_mb,
                "single_task_reserve_mb": cfg.single_task_reserve_mb,
                "overall_share_max_mb": cfg.overall_share_max_mb,
            }
        )
        await self.client.set_local_config(current)
        self._applied = signature
        logger.info("Engine configuration applied")

    async def local_config(self) -> JsonObject:
        return await self.client.local_config()

    # -------------------------------------------------------------------- status

    def _state(self) -> tuple[EngineState, str]:
        if not self.config.enabled:
            return "disabled", "下载引擎已在设置中停用。"
        if self.binary() is None:
            return "missing_binary", "未找到 xunlei-pan-cli 程序，请在设置中指定路径。"
        if self.process.alive:
            if self._snapshot:
                return "running", ""
            return "starting", "下载引擎正在启动…"
        if self._desired and self.process.last_exit_code is not None:
            return "crashed", self._message or f"下载引擎已退出（{self.process.last_exit_code}）。"
        return "stopped", self._message

    def status(self) -> EngineStatus:
        state, message = self._state()
        snap = self._snapshot if state == "running" else {}
        auth = snap.get("auth_status") if isinstance(snap.get("auth_status"), dict) else {}
        login = str(auth.get("status") or "") if isinstance(auth, dict) else ""
        runner = snap.get("runner_status") if isinstance(snap.get("runner_status"), dict) else {}
        runner_message = ""
        if isinstance(runner, dict):
            info = runner.get("message")
            if isinstance(info, dict):
                runner_message = str(info.get("title") or "")
        user = parse_user(snap)
        disks = [
            EngineDisk(
                path=str(d.get("path") or ""),
                used=_int(d.get("usage")),
                total=_int(d.get("limit")),
                is_root=bool(d.get("is_root_path")),
            )
            for d in snap.get("downloads") or []
            if isinstance(d, dict)
        ]
        binary = self.binary()
        app_user = self.api.credentials.user_id
        return EngineStatus(
            enabled=self.config.enabled,
            state=state,
            message=message,
            pid=self.process.pid if self.process.alive else None,
            uptime_seconds=int(time.time() - self.process.started_at) if self.process.alive else 0,
            restarts=self._restarts,
            last_exit_code=self.process.last_exit_code,
            binary_path=str(binary or ""),
            binary_version=binary_version(binary) if binary else "",
            engine_version=str(snap.get("client_version") or ""),
            home_dir=str(self.home),
            control_port=self.config.control_port,
            device_id=self.api.device_id,
            space=self.api.device_space,
            login_status=login,
            logged_in=login == "complete" and bool(user.id),
            user=user,
            user_mismatch=bool(user.id and app_user and user.id != app_user),
            runner_status=str(runner.get("status") or "") if isinstance(runner, dict) else "",
            runner_message=runner_message,
            running_tasks=self._running_tasks,
            disks=disks,
            conflicts=[
                ForeignEngine.model_validate(item)
                for item in foreign_engines(self.process.pid)
                if item.get("home") != str(self.home)
            ],
        )

    def require_running(self) -> EngineClient:
        if not self.process.alive:
            raise AppError("engine_unavailable", 503)
        return self.client

    def logs(self, lines: int) -> EngineLogs:
        path = self.home / "engine.log"
        return EngineLogs(path=str(path), lines=tail_log(path, lines * 400)[-lines:])

    # --------------------------------------------------------------------- login

    async def login_qrcode(self) -> bytes:
        return await self.require_running().qr_image()

    async def login_status(self) -> EngineLoginStatus:
        status = str((await self.require_running().qr_status()).get("status") or "")
        if status == "complete":
            await self._refresh()
        return EngineLoginStatus(status=status, logged_in=status == "complete")

    async def login_url(self) -> str:
        return await self.require_running().login_url()

    async def logout(self) -> None:
        await self.require_running().signout()
        await self._refresh()

    # --------------------------------------------------------------------- trial

    async def trial(self) -> TrialInfo:
        client = self.require_running()
        info = await client.trial_info()
        config = await client.trial_config()
        usage = info.get("usage") if isinstance(info.get("usage"), dict) else {}
        countdown = info.get("count_down") if isinstance(info.get("count_down"), dict) else {}
        stats = info.get("statistic") if isinstance(info.get("statistic"), dict) else {}
        assert isinstance(usage, dict) and isinstance(countdown, dict) and isinstance(stats, dict)
        return TrialInfo(
            supported=True,
            status=_int(info.get("status")),
            total=_int(usage.get("total")),
            used=_int(usage.get("used")),
            remaining_seconds=max(0, _int(countdown.get("total")) - _int(countdown.get("used"))),
            timeout_seconds=_int(config.get("try_timeout_sec")),
            average_speed=_int(stats.get("average_speed")),
            saved_seconds=_int(stats.get("saved_sec")),
            stop_reason=str(stats.get("stop_reason") or ""),
        )

    async def clean_trial(self) -> TrialInfo:
        await self.require_running().trial_clean()
        return await self.trial()

    async def apply_trial(self) -> TrialInfo:
        await self.require_running().trial_apply()
        return await self.trial()

    # ------------------------------------------------------------------- folders

    async def folders(self, parent_id: str) -> EngineFolderList:
        data = await self.require_running().list_local_files(self.api.device_space, parent_id)
        folders: list[EngineFolder] = []
        for item in data.get("files") or []:
            if not isinstance(item, dict) or item.get("kind") != "drive#folder":
                continue
            params = item.get("params") if isinstance(item.get("params"), dict) else {}
            assert isinstance(params, dict)
            path = str(params.get("RealPath") or params.get("AliasPath") or "")
            name = str(item.get("name") or "") or Path(path).name
            if str(params.get("default", "")).lower() == "true":
                name = str(params.get("category_name") or name)
            elif parent_id == "" and path:
                name = Path(path.rstrip("/")).name or path
            folders.append(
                EngineFolder(
                    id=str(item.get("id") or ""),
                    name=name,
                    path=path,
                    writable=str(params.get("is_write", "true")).lower() not in ("false", "0"),
                )
            )
        return EngineFolderList(folders=folders)

    # --------------------------------------------------------------------- tasks

    async def _engine_tasks(self, phases: str) -> list[DriveTask]:
        tasks: list[DriveTask] = []
        token = ""
        for _ in range(MAX_TASK_PAGES):
            page = await self.api.list_tasks(
                task_type=None,
                space=self.api.device_space,
                phases=phases,
                page_token=token,
                types=ENGINE_TYPES,
            )
            tasks.extend(t for t in page.tasks if t.type in ENGINE_TYPES)
            token = page.next_page_token
            if not token:
                break
        return tasks

    async def live(self) -> LiveDownloads:
        """In-memory task state, shared by concurrent callers for a short moment."""
        client = self.require_running()
        async with self._live_lock:
            if self._live is None or time.monotonic() - self._live_at > LIVE_TTL:
                self._live = parse_live(await client.debug_snapshot())
                self._live_at = time.monotonic()
            return self._live

    async def _live_by_id(self) -> dict[str, LiveTask]:
        if not self.config.live_progress or not self.process.alive:
            return {}
        try:
            return {task.id: task for task in (await self.live()).tasks}
        except AppError as error:
            logger.debug("Live engine state unavailable: %s", error.message)
            return {}

    async def list_downloads(self, status_filter: DownloadFilter) -> DownloadList:
        live = await self._live_by_id()
        # Statuses follow the in-memory engine state, so filter after overlaying it; the cloud
        # query still uses the phase filter (a task the engine just finished is fetched again
        # once the cloud catches up).
        tasks = [
            overlay(task, live[task.id]) if task.id in live else task
            for task in map(to_download, await self._engine_tasks(FILTER_PHASES[status_filter]))
        ]
        wanted = FILTER_STATUSES[status_filter]
        tasks = [t for t in tasks if t.status in wanted]
        if status_filter == "all":
            self._summary = summarize(tasks)
            self._summary_at = time.monotonic()
        elif self._summary is None or time.monotonic() - self._summary_at > SUMMARY_TTL:
            every = [to_download(t) for t in await self._engine_tasks(ENGINE_PHASES)]
            self._summary = summarize(every)
            self._summary_at = time.monotonic()
        summary = self._summary.model_copy()
        if status_filter == "active":
            summary.active = len(tasks)
            summary.speed = sum(t.speed for t in tasks)
        return DownloadList(tasks=tasks, summary=summary, next_page_token="")

    def _invalidate_summary(self) -> None:
        self._summary_at = 0.0

    async def get_download(self, task_id: str) -> DownloadTask:
        task = to_download(await self.api.get_task(task_id, self.api.device_space))
        live = (await self._live_by_id()).get(task_id)
        return overlay(task, live) if live else task

    async def add_links(
        self, urls: list[str], *, name: str, files: list[int] | None, folder_id: str
    ) -> DownloadCreateResponse:
        cleaned = [url.strip() for url in urls if url.strip()]
        results: list[DownloadCreateResult] = []
        for url in cleaned:
            title = name.strip() if len(cleaned) == 1 and name.strip() else guess_name(url)
            try:
                task = await self.api.engine_add(
                    url, title or "download", folder_id=folder_id, files=files
                )
                results.append(DownloadCreateResult(source=url, ok=True, task_id=task.id))
            except AppError as error:
                results.append(DownloadCreateResult(source=url, ok=False, error=error.message))
        self._invalidate_summary()
        return DownloadCreateResponse(results=results)

    async def add_cloud_files(self, file_ids: list[str], folder_id: str) -> DownloadCreateResponse:
        results: list[DownloadCreateResult] = []
        for file_id in dict.fromkeys(file_ids):
            try:
                info = await self.api.get_file(file_id)
                task = await self.api.engine_fetch(file_id, info.name, folder_id=folder_id)
                results.append(DownloadCreateResult(source=file_id, ok=True, task_id=task.id))
            except AppError as error:
                results.append(DownloadCreateResult(source=file_id, ok=False, error=error.message))
        self._invalidate_summary()
        return DownloadCreateResponse(results=results)

    async def _task(self, task_id: str) -> DriveTask:
        return await self.api.get_task(task_id, self.api.device_space)

    async def set_paused(self, task_ids: list[str], paused: bool) -> int:
        changed = 0
        phase = "pause" if paused else "running"
        for task_id in task_ids:
            task = await self._task(task_id)
            if paused and task.phase not in ("PHASE_TYPE_PENDING", "PHASE_TYPE_RUNNING"):
                continue
            if not paused and task.phase != "PHASE_TYPE_PAUSED":
                continue
            await self.api.update_task(
                task, {"spec": json.dumps({"phase": phase})}, self.api.device_space
            )
            changed += 1
        self._invalidate_summary()
        return changed

    async def retry(self, task_ids: list[str]) -> DownloadCreateResponse:
        """Failed tasks cannot be moved back to running; submit an equivalent task instead."""
        results: list[DownloadCreateResult] = []
        for task_id in task_ids:
            task = await self._task(task_id)
            params = task.params
            folder = params.get("parent_folder_id", "")
            try:
                if task.type == "user#download":
                    new = await self.api.engine_fetch(
                        params.get("file_id", ""), task.name, folder_id=folder
                    )
                else:
                    files = parse_indexes(params.get("sub_file_index", "")) or None
                    new = await self.api.engine_add(
                        params.get("url", ""), task.name, folder_id=folder, files=files
                    )
                await self.api.delete_tasks(
                    [task.id], delete_files=False, space=self.api.device_space
                )
                results.append(DownloadCreateResult(source=task.id, ok=True, task_id=new.id))
            except AppError as error:
                results.append(DownloadCreateResult(source=task.id, ok=False, error=error.message))
        self._invalidate_summary()
        return DownloadCreateResponse(results=results)

    async def delete(self, task_ids: list[str], delete_files: bool | None) -> int:
        """Delete tasks; with files, also their data inside the engine download folders.

        The engine keeps the data of finished tasks even with `delete_files=true`, so the
        `real_path` of each task is removed here. Returns the number of removed paths.
        """
        remove = self.config.delete_files_with_task if delete_files is None else delete_files
        paths: list[Path] = []
        if remove:
            for task_id in task_ids:
                with contextlib.suppress(AppError):
                    real = (await self._task(task_id)).params.get("real_path", "")
                    if real:
                        paths.append(Path(real))
        await self.api.delete_tasks(task_ids, delete_files=remove, space=self.api.device_space)
        self._invalidate_summary()
        return await asyncio.to_thread(remove_inside, paths, self.download_dirs)
