"""One observed Runner inventory shared by list, detail, live and mutations."""

import asyncio
import hashlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import httpx

from app.core.errors import AppError
from app.repositories.runner_tasks import RunnerTaskRepository, SavedTask
from app.schemas.engine import (
    DownloadActionResponse,
    DownloadActionResult,
    DownloadCreateResponse,
    DownloadCreateResult,
    DownloadFilter,
    DownloadList,
    DownloadOperation,
    DownloadTask,
    LiveDownloads,
    TaskCapabilities,
)
from app.schemas.xunlei import DriveTask
from app.services.engine.local_db import (
    LocalIdentity,
    LocalSnapshot,
    read_snapshot,
    validate_identity,
)
from app.services.xunlei.captcha import compress_indexes
from app.services.xunlei.links import guess_name

if TYPE_CHECKING:
    from app.services.engine.service import EngineService

logger = logging.getLogger(__name__)


def now() -> str:
    return datetime.now(UTC).isoformat()


def newer_timestamp(candidate: str, observed: str) -> bool:
    if not candidate or not observed:
        return False
    try:
        left, right = datetime.fromisoformat(candidate), datetime.fromisoformat(observed)
        return left.astimezone(UTC) > right.astimezone(UTC)
    except ValueError:
        return False


def record_fingerprint(record: dict[str, Any] | None) -> str:
    if record is None:
        return ""
    return hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()


def passive_history(record: dict[str, Any] | None, operation: DownloadOperation) -> bool:
    return bool(record is not None and not record.get("DLTaskId") and operation.cloud_synced)


def observed_task_ids(raw: dict[str, Any] | None) -> set[str]:
    if raw is None:
        return set()
    ids = {str(row.get("id")) for row in raw.get("Process", []) if isinstance(row, dict)}
    running = raw.get("Running")
    if isinstance(running, dict):
        ids.update(str(tid) for tid, active in running.items() if active)
    return ids


def cleanup_paths(
    paths: list[str], roots: list[Path], protected_paths: list[str] | None = None
) -> list[str]:
    """Only unlink individually associated files; never recursively erase an inferred folder.

    Real paths are resolved before checking roots. A BT directory may contain unrelated data,
    so empty directories are removed with rmdir only. Failures remain on the history row.
    """
    bases = [root.resolve() for root in roots]
    protected = [
        Path(raw + suffix).resolve() for raw in protected_paths or [] for suffix in ("", ".xltd")
    ]
    errors: list[str] = []
    associated = set(paths)
    for raw in paths:
        # The task records the final name while unfinished data lives in <name>.xltd.
        # Derive that exact sibling only; never glob or recurse through a task folder.
        if not Path(raw).is_dir():
            associated.add(raw + ".xltd")
    targets = sorted(associated, key=lambda value: (len(Path(value).parts), value), reverse=True)
    for raw in targets:
        path = Path(raw)
        target = path.resolve()
        if not any(target != base and target.is_relative_to(base) for base in bases):
            errors.append(f"未删除不在下载目录内的路径：{path.name}")
            continue
        if any(target == active or target.is_relative_to(active) for active in protected):
            errors.append(f"文件仍被其他下载任务使用：{path.name}")
            continue
        try:
            if path.is_symlink():
                # Resolving also checks the link's target; no link traversal during deletion.
                path.unlink(missing_ok=True)
            elif target.is_dir():
                target.rmdir()
            else:
                target.unlink(missing_ok=True)
        except OSError:
            errors.append(f"文件清理失败：{path.name}")
    return errors


class RunnerTasks:
    def __init__(self, service: "EngineService") -> None:
        self.service = service
        self.repository = RunnerTaskRepository(service._settings.repository.db)
        self.identity: LocalIdentity | None = None
        self.history: dict[str, SavedTask] = {}
        self.local: LocalSnapshot | None = None
        self.live_raw: dict[str, Any] | None = None
        self.cloud: list[DriveTask] = []
        self.cloud_at = 0.0
        self.cloud_job: asyncio.Task[None] | None = None
        self.cloud_error = ""
        self.snapshot: DownloadList | None = None
        self.collected_at = 0.0
        self.version = 0
        self.epoch = uuid.uuid4().hex
        self.lock = asyncio.Lock()
        self.action_locks: dict[str, asyncio.Lock] = {}
        self.create_lock = asyncio.Lock()
        self.ambiguous: set[tuple[str, str, str, str]] = set()
        self.persisted: dict[str, str] = {}

    def current_identity(self) -> LocalIdentity:
        svc = self.service
        account = svc.api.config.account
        return LocalIdentity(
            home=str(svc.home.resolve()),
            device_id=svc.api.device_id,
            platform=svc.config.platform,
            user_id=svc.api.credentials.user_id,
            client_id=account.client_id,
            client_secret=account.client_secret,
            instance_tag=self._instance_tag(),
        )

    def _instance_tag(self) -> str:
        try:
            stat = (self.service.home / ".drive").stat()
            return f"{stat.st_dev}:{stat.st_ino}"
        except OSError:
            return "missing"

    def account_matches(self, identity: LocalIdentity) -> bool:
        user = self.service._snapshot.get("user")
        engine_user = str(user.get("id") or "") if isinstance(user, dict) else ""
        return not engine_user or engine_user == identity.user_id

    def check_mutation_identity(self, identity: LocalIdentity) -> None:
        if self.current_identity() != identity or not self.account_matches(identity):
            raise AppError("engine_instance_changed", 409)

    async def ensure_identity(self) -> LocalIdentity:
        identity = self.current_identity()
        if identity != self.identity:
            if self.cloud_job is not None:
                self.cloud_job.cancel()
            self.identity = identity
            self.epoch = uuid.uuid4().hex
            self.history = await asyncio.to_thread(self.repository.load, identity.key)
            self.local = self.live_raw = None
            self.cloud, self.cloud_error, self.cloud_at = [], "", 0.0
            self.snapshot, self.collected_at = None, 0.0
            self.ambiguous.clear()
            self.persisted.clear()
        return identity

    async def close(self) -> None:
        if self.cloud_job is not None:
            self.cloud_job.cancel()
            await asyncio.gather(self.cloud_job, return_exceptions=True)

    def invalidate(self) -> None:
        self.collected_at = 0.0
        self.cloud_at = 0.0

    async def _enrich(self, identity: LocalIdentity) -> None:
        from app.services.engine.service import ENGINE_PHASES

        try:
            tasks = await self.service._engine_tasks(ENGINE_PHASES)
            if self.identity == identity:
                async with self.lock:
                    if self.identity == identity:
                        self.cloud, self.cloud_error = tasks, ""
                        # Optional cloud enrichment can lag behind a confirmed deletion.
                        # Only a fresh local observation may reopen a deleted history row.
                        self.collected_at = 0.0
        except AppError as error:
            if self.identity == identity:
                self.cloud_error = error.message
        except Exception:
            logger.exception("Runner cloud enrichment failed")
            if self.identity == identity:
                self.cloud_error = "云端补充信息暂不可用"
        finally:
            if self.identity == identity:
                self.cloud_at = time.monotonic()

    async def collect(self, *, force: bool = False) -> DownloadList:
        async with self.lock:
            identity = await self.ensure_identity()
            if (
                self.snapshot is not None
                and not force
                and time.monotonic() - self.collected_at < 0.4
            ):
                return self.snapshot.model_copy(deep=True)
            if (
                self.cloud_job is None or self.cloud_job.done()
            ) and time.monotonic() - self.cloud_at > self.service.config.task_poll_seconds:
                self.cloud_job = asyncio.create_task(
                    self._enrich(identity), name="runner-enrichment"
                )
            errors: dict[str, str] = {}

            # Local sources run independently; neither waits for the optional cloud request.
            async def disk() -> LocalSnapshot:
                return await asyncio.to_thread(read_snapshot, identity)

            async def memory() -> dict[str, Any]:
                await asyncio.to_thread(validate_identity, identity)
                if not self.account_matches(identity):
                    raise AppError("engine_instance_changed", 409)
                return await self.service.require_running().debug_snapshot()

            sources = await asyncio.gather(disk(), memory(), return_exceptions=True)
            local, raw = sources
            db_valid = isinstance(local, LocalSnapshot)
            live_valid = isinstance(raw, dict) and isinstance(raw.get("Process"), list)
            self.local = local if db_valid else None
            self.live_raw = raw if live_valid else None
            if not db_valid:
                logger.debug("Runner database snapshot unavailable: %r", local)
                errors["database"] = "本地任务记录暂不可用"
            if not live_valid:
                errors["live"] = (
                    "实时状态暂不可用" if self.service.process.alive else "下载引擎已停止"
                )
            if self.cloud_error:
                errors["cloud"] = "云端补充信息暂不可用"
            if not db_valid and not live_valid and not self.history and not self.cloud:
                raise AppError("engine_unavailable", 503, "下载任务暂不可用，请检查下载引擎。")
            return await self._merge(identity, errors, db_valid, live_valid)

    async def _merge(
        self, identity: LocalIdentity, errors: dict[str, str], db_valid: bool, live_valid: bool
    ) -> DownloadList:
        from app.services.engine.service import (
            STATUS_BY_PHASE,
            overlay,
            parse_live,
            summarize,
            to_download,
        )

        observed = now()
        self.version += 1
        rows = {tid: saved.task.model_copy(deep=True) for tid, saved in self.history.items()}
        for cloud in self.cloud:
            remote = to_download(cloud)
            if remote.id not in rows:
                rows[remote.id] = remote
            else:
                # Cloud enriches metadata without rolling back local observations.
                old = rows[remote.id]
                operation = self.history[remote.id].operation
                cloud_newer = newer_timestamp(remote.updated_at, old.observed_at)
                if (not old.observed_at or old.stale or cloud_newer) and (
                    not operation or operation.action == "create"
                ):
                    for field in (
                        "phase",
                        "status",
                        "progress",
                        "done_bytes",
                        "error",
                        "message",
                        "updated_at",
                    ):
                        setattr(old, field, getattr(remote, field))
                    if remote.size:
                        old.size = remote.size
                for name in (
                    "name",
                    "url",
                    "cloud_file_id",
                    "sub_files",
                    "folder_id",
                    "hash",
                    "icon",
                    "created_at",
                ):
                    if not getattr(old, name) and getattr(remote, name):
                        setattr(old, name, getattr(remote, name))
                old.params = {**remote.params, **old.params}
                if remote.params.get("speedup"):
                    old.speedup = remote.speedup
        db_rows: dict[str, dict[str, Any]] = {}
        if self.local is not None:
            db_rows = {str(item["TaskId"]): item for item in self.local.tasks}
        files: dict[str, list[str]] = {}
        if self.local is not None:
            for item in self.local.files:
                if item.get("TaskId") and item.get("RealPath") and not item.get("IsDeleted"):
                    files.setdefault(str(item["TaskId"]), []).append(str(item["RealPath"]))
        for tid, item in db_rows.items():
            phase = str(item.get("Phase") or "")
            task = rows.get(tid) or to_download(
                DriveTask.model_validate(
                    {
                        "id": tid,
                        "type": item.get("TaskType") or "user#download-url",
                        "name": item.get("FileName") or "",
                        "phase": phase,
                        "params": {
                            "url": item.get("Url") or "",
                            "file_id": item.get("FileId") or "",
                        },
                    }
                )
            )
            prior = self.history.get(tid)
            confirmed = prior.operation if prior else None
            if (
                confirmed
                and confirmed.status == "confirmed"
                and confirmed.observed_status
                and confirmed.database_phase == phase
                and confirmed.observed_status != STATUS_BY_PHASE.get(phase)
            ):
                task.status = prior.task.status if prior else task.status
                task.phase = prior.task.phase if prior else task.phase
            elif phase in STATUS_BY_PHASE:
                task.phase, task.status = phase, STATUS_BY_PHASE[phase]
            info = item.get("Info") or {}
            size, done = int(info.get("FileSize") or 0), int(info.get("DownloadSize") or 0)
            if size:
                task.size, task.done_bytes = size, done
                task.progress = min(100, max(0, done * 100 / size))
            if task.status == "complete":
                task.progress, task.done_bytes = 100, task.size
            task.local_path = str(item.get("FullPath") or task.local_path)
            task.speed = 0  # Persisted kernel speed is not live telemetry.
            task.speedup_speed = 0
            task.url = task.url or str(item.get("Url") or "")
            task.cloud_file_id = task.cloud_file_id or str(item.get("FileId") or "")
            task.paths = list(
                dict.fromkeys(
                    [
                        *task.paths,
                        *files.get(tid, []),
                        *([task.local_path] if task.local_path else []),
                    ]
                )
            )
            rows[tid] = task
        live_ids: set[str] = set()
        if self.live_raw is not None:
            live = parse_live(self.live_raw)
            raw_by_id = {
                str(item.get("id")): item
                for item in self.live_raw["Process"]
                if isinstance(item, dict)
            }
            for live_task in live.tasks:
                raw_task = to_download(DriveTask.model_validate(raw_by_id[live_task.id]))
                task = rows.get(live_task.id) or raw_task
                for name in (
                    "name",
                    "url",
                    "cloud_file_id",
                    "sub_files",
                    "folder_id",
                    "hash",
                    "created_at",
                ):
                    if getattr(raw_task, name):
                        setattr(task, name, getattr(raw_task, name))
                task.params = {**task.params, **raw_task.params}
                task.error, task.message = raw_task.error, raw_task.message
                if raw_task.updated_at:
                    task.updated_at = raw_task.updated_at
                if raw_task.params.get("speedup"):
                    task.speedup = raw_task.speedup
                rows[live_task.id] = overlay(task, live_task)
                phase = "PENDING" if live_task.status == "queued" else live_task.status.upper()
                rows[live_task.id].phase = "PHASE_TYPE_" + phase
                live_ids.add(live_task.id)
        live_ids.update(observed_task_ids(self.live_raw))
        output: list[DownloadTask] = []
        changed: list[SavedTask] = []
        for tid, task in rows.items():
            saved = self.history.get(tid) or SavedTask(task, "", [], False, None)
            record = db_rows.get(tid)
            if record is not None:
                saved.dl_task_id = str(record.get("DLTaskId") or "")
            task.stale = tid not in db_rows and tid not in live_ids
            task.observed_at = observed if not task.stale else task.observed_at
            task.version = self.version
            task.operation = saved.operation
            operation = saved.operation
            if (
                operation
                and operation.action == "delete"
                and operation.status in ("pending", "submitted", "timeout", "partial", "failed")
                and db_valid
                and live_valid
                and (record is None or passive_history(record, operation))
                and tid not in live_ids
            ):
                # Deletion may settle after the HTTP deadline or a backend restart.
                # A failed source must never count as an empty local inventory.
                operation.local_history_retained = record is not None
                operation.locally_removed = record is None
                if operation.cloud_synced:
                    if operation.delete_files_requested or operation.cleanup_errors:
                        operation.status = "partial"
                        operation.message = "任务已移除，文件清理尚未完成，请重试删除。"
                    else:
                        operation.status = "confirmed"
                        operation.message = ""
                        saved.deleted = True
                        saved.retired_record = record_fingerprint(record)
                else:
                    operation.status = "partial"
                    operation.message = "本地任务已移除，云端同步尚未完成，请重试删除。"
            if operation and operation.status in ("submitted", "timeout") and not task.stale:
                reached = (
                    (operation.action == "pause" and task.status == "paused")
                    or (
                        operation.action == "resume"
                        and task.status in ("queued", "running", "complete")
                    )
                    or operation.action == "create"
                )
                if reached:
                    operation.status = "confirmed"
                    operation.message = ""
                    operation.observed_status = task.status
                    operation.database_phase = str(record.get("Phase") or "") if record else ""
            if tid not in live_ids:
                task.speed = task.speedup_speed = 0
            mapped = bool(record and saved.dl_task_id)
            running = self.service.process.alive and self.account_matches(identity)
            controllable = mapped or self.service.config.local_control_fallback
            cleanup_retry = bool(
                saved.operation
                and saved.operation.action == "delete"
                and (saved.operation.locally_removed or saved.operation.local_history_retained)
            )
            if saved.deleted and (
                tid in live_ids
                or (record is not None and record_fingerprint(record) != saved.retired_record)
            ):
                saved.deleted = False
                saved.retired_record = ""
                saved.operation = DownloadOperation(
                    action="delete",
                    status="partial",
                    message="任务再次出现，请重试删除。",
                    locally_removed=False,
                )
                task.operation = saved.operation
            # Unmapped history is retired through the proxy only after live execution ends.
            task.capabilities = TaskCapabilities(
                pause=running and controllable and task.status in ("running", "queued"),
                resume=running and controllable and task.status == "paused",
                retry=running and task.status == "error" and bool(task.url or task.cloud_file_id),
                delete=running and (controllable or cleanup_retry),
            )
            if not saved.deleted:
                output.append(task)
            saved.task = task
            saved.paths = list(
                dict.fromkeys(
                    [*saved.paths, *task.paths, *([task.local_path] if task.local_path else [])]
                )
            )
            self.history[tid] = saved
            fingerprint = (
                task.model_dump_json(exclude={"version", "observed_at"})
                + saved.dl_task_id
                + str(saved.deleted)
                + str(saved.paths)
                + saved.retired_record
            )
            if self.persisted.get(tid) != fingerprint:
                changed.append(saved)
                self.persisted[tid] = fingerprint
        if changed:
            await asyncio.to_thread(self.repository.save_many, identity.key, changed)
        self.snapshot = DownloadList(
            tasks=output,
            epoch=self.epoch,
            summary=summarize(output),
            next_page_token="",
            version=self.version,
            observed_at=observed,
            stale=not db_valid and not live_valid,
            source_errors=errors,
        )
        self.collected_at = time.monotonic()
        return self.snapshot.model_copy(deep=True)

    async def list_downloads(self, status_filter: DownloadFilter) -> DownloadList:
        from app.services.engine.service import FILTER_STATUSES

        snapshot = await self.collect()
        snapshot.tasks = [
            task for task in snapshot.tasks if task.status in FILTER_STATUSES[status_filter]
        ]
        return snapshot

    async def get(self, task_id: str) -> DownloadTask:
        for task in (await self.collect()).tasks:
            if task.id == task_id:
                return task
        raise AppError("not_found", 404, "下载任务不存在。")

    async def live(self) -> LiveDownloads:
        from app.services.engine.service import parse_live

        snapshot = await self.collect()
        live = parse_live(self.live_raw or {})
        return live.model_copy(
            update={
                "downloads": snapshot.tasks,
                "version": snapshot.version,
                "epoch": snapshot.epoch,
                "observed_at": snapshot.observed_at,
                "stale": snapshot.stale,
                "source_errors": snapshot.source_errors,
            }
        )

    async def _save_operation(self, tid: str, operation: DownloadOperation) -> None:
        saved = self.history[tid]
        saved.operation = operation
        assert self.identity is not None
        await asyncio.to_thread(self.repository.save, self.identity.key, saved)
        self.collected_at = 0.0

    async def action(
        self, ids: list[str], action: Literal["pause", "resume", "delete"], remove: bool = False
    ) -> DownloadActionResponse:
        async with self.lock:
            await self.ensure_identity()
            epoch = self.epoch
        results: list[DownloadActionResult] = []
        for tid in dict.fromkeys(ids):
            async with self.action_locks.setdefault(tid, asyncio.Lock()):
                try:
                    result = await self._action(tid, action, remove)
                except AppError as error:
                    result = DownloadActionResult(
                        task_id=tid, action=action, status="failed", message=error.message
                    )
                results.append(result)
        return DownloadActionResponse(
            ok=all(item.status == "confirmed" for item in results),
            results=results,
            version=self.version,
            epoch=epoch,
        )

    async def _action(self, tid: str, action: str, remove: bool) -> DownloadActionResult:
        cfg = self.service.config
        task: DownloadTask | None = None
        operation = DownloadOperation(
            action=action, status="pending", delete_files_requested=action == "delete" and remove
        )
        identity: LocalIdentity | None = None
        try:
            async with asyncio.timeout(cfg.control_timeout_seconds):
                await self.collect(force=True)
                identity = self.identity
                assert identity is not None
                existing = self.history.get(tid)
                if existing and existing.deleted and action == "delete":
                    if not remove:
                        if existing.operation:
                            return DownloadActionResult(
                                task_id=tid, **existing.operation.model_dump()
                            )
                        return DownloadActionResult(task_id=tid, action=action, status="confirmed")
                    # An explicit cleanup retry must recheck local sources even if the task
                    # was retired already; an earlier success may predate partial-file cleanup.
                    existing.deleted = False
                    self.collected_at = 0.0
                task = await self.get(tid)
                cleanup_retry = bool(
                    existing
                    and existing.operation
                    and (
                        existing.operation.locally_removed
                        or existing.operation.local_history_retained
                    )
                    and existing.operation.action == "delete"
                    and action == "delete"
                )
                if task.stale and not cfg.local_control_fallback and not cleanup_retry:
                    operation.status = "unsupported"
                    operation.message = "本地任务记录暂不可用，无法确认此操作。"
                elif (action == "pause" and task.status == "paused" and not task.stale) or (
                    action == "resume" and task.status in ("queued", "running") and not task.stale
                ):
                    operation.status = "confirmed"
                elif not getattr(task.capabilities, action):
                    operation.status = "unsupported"
                    operation.message = "当前任务无法执行此操作，请检查引擎状态和本地任务记录。"
                else:
                    saved = self.history[tid]
                    paths = list(saved.paths)
                    previous = saved.operation
                    removed_before = bool(
                        previous
                        and previous.action == "delete"
                        and (previous.locally_removed or previous.local_history_retained)
                    )
                    operation.locally_removed = bool(previous and previous.locally_removed)
                    operation.local_history_retained = bool(
                        previous and previous.local_history_retained
                    )
                    operation.cloud_synced = bool(previous and previous.cloud_synced)
                    db_ids = (
                        {str(row["TaskId"]) for row in self.local.tasks} if self.local else set()
                    )
                    had_local = tid in db_ids or tid in observed_task_ids(self.live_raw)
                    use_touch = bool(
                        saved.dl_task_id
                        and tid in db_ids
                        and self.service.capabilities().touch_tasks
                    )
                    proxy_sent = False
                    started = time.monotonic()

                    async def proxy() -> None:
                        nonlocal proxy_sent
                        await self.service.ensure_launcher()
                        self.check_mutation_identity(identity)
                        client = self.service.require_running()
                        if action == "delete":
                            await client.delete_tasks([tid], self.service.api.device_space)
                            operation.cloud_synced = True
                        else:
                            await client.patch_task(
                                tid,
                                "user#download"
                                if task and task.source == "cloud"
                                else "user#download-url",
                                self.service.api.device_space,
                                action == "pause",
                            )
                        proxy_sent = True
                        operation.transport = "runner_proxy"

                    # Complete earlier collections before sending a mutation.
                    async with self.lock:
                        self.check_mutation_identity(identity)
                        await self._save_operation(tid, operation)
                    if not removed_before:
                        if use_touch:
                            operation.transport = "touch"
                            try:
                                await self.service.require_running().touch_task(
                                    saved.dl_task_id,
                                    {"pause": "stop", "resume": "start", "delete": "delete"}[
                                        action
                                    ],
                                )
                            except AppError:
                                if not cfg.local_control_fallback:
                                    raise
                                await proxy()
                        elif cfg.local_control_fallback:
                            await proxy()
                        else:
                            raise AppError(
                                "invalid_request", 409, "本地任务标识不可用，无法执行操作。"
                            )
                    while True:
                        snapshot = await self.collect(force=True)
                        if self.identity != identity:
                            raise AppError("engine_instance_changed", 409)
                        current = next((row for row in snapshot.tasks if row.id == tid), None)
                        local_ids = (
                            {str(row["TaskId"]) for row in self.local.tasks}
                            if self.local
                            else set()
                        )
                        memory_ids = observed_task_ids(self.live_raw)
                        record = (
                            next(
                                (row for row in self.local.tasks if str(row["TaskId"]) == tid),
                                None,
                            )
                            if self.local
                            else None
                        )
                        fresh = current is not None and not current.stale
                        removed_now = (
                            self.local is not None
                            and self.live_raw is not None
                            and (tid not in local_ids or passive_history(record, operation))
                            and tid not in memory_ids
                            and (had_local or removed_before or operation.cloud_synced)
                        )
                        confirmed = (
                            (
                                action == "pause"
                                and fresh
                                and current is not None
                                and current.status == "paused"
                            )
                            or (
                                action == "resume"
                                and fresh
                                and current is not None
                                and current.status in ("queued", "running", "complete")
                            )
                            or (action == "delete" and removed_now)
                        )
                        if confirmed:
                            task = current or task
                            operation.status = "confirmed"
                            operation.message = ""
                            operation.observed_status = task.status
                            operation.database_phase = (
                                next(
                                    (
                                        str(row.get("Phase") or "")
                                        for row in self.local.tasks
                                        if str(row["TaskId"]) == tid
                                    ),
                                    "",
                                )
                                if self.local
                                else ""
                            )
                            if action == "delete":
                                operation.local_history_retained = record is not None
                                operation.locally_removed = record is None
                                if cfg.delete_cloud_sync and not operation.cloud_synced:
                                    try:
                                        await proxy()
                                    except AppError:
                                        operation.status, operation.message = (
                                            "partial",
                                            "本地任务已移除，云端同步失败，请重试删除。",
                                        )
                                elif not cfg.delete_cloud_sync and not operation.cloud_synced:
                                    operation.status, operation.message = (
                                        "partial",
                                        "本地任务已移除，云端记录保留，任务可能再次出现。",
                                    )
                                if remove:
                                    active_ids = observed_task_ids(self.live_raw) | {
                                        str(row["TaskId"])
                                        for row in (self.local.tasks if self.local else [])
                                        if row.get("DLTaskId")
                                    }
                                    protected_paths = [
                                        path
                                        for other in active_ids - {tid}
                                        if other in self.history
                                        for path in self.history[other].paths
                                    ]
                                    operation.cleanup_errors = await asyncio.to_thread(
                                        cleanup_paths,
                                        paths,
                                        self.service.download_dirs,
                                        protected_paths,
                                    )
                                    if operation.cleanup_errors:
                                        operation.status, operation.message = (
                                            "partial",
                                            "任务已移除，部分文件未能清理，请重试删除。",
                                        )
                                self.history[tid].deleted = operation.status == "confirmed"
                                self.history[tid].retired_record = record_fingerprint(record)
                            break
                        if (
                            cfg.local_control_fallback
                            and not proxy_sent
                            and time.monotonic() - started >= cfg.control_timeout_seconds / 3
                        ):
                            await proxy()
                        await asyncio.sleep(0.1)
        except TimeoutError:
            operation.status = "partial" if operation.locally_removed else "timeout"
            operation.message = (
                "云端任务已移除，本地移除尚未确认，文件已保留。"
                if action == "delete" and operation.cloud_synced and not operation.locally_removed
                else "操作尚未完全确认，请稍后查看任务状态。"
            )
        except AppError as error:
            operation.status = "not_found" if error.status == 404 else "failed"
            operation.message = error.message
        if identity is not None and identity == self.identity and tid in self.history:
            async with self.lock:
                await self._save_operation(tid, operation)
                self.invalidate()
        if task is not None:
            task.operation = operation
        return DownloadActionResult(task_id=tid, task=task, **operation.model_dump())

    async def _create(self, task_type: str, name: str, params: dict[str, str]) -> DownloadTask:
        from app.services.engine.service import to_download

        async with self.create_lock:
            await self.collect()
            identity = self.identity
            assert identity is not None
            key = (
                task_type,
                params.get("url") or params.get("file_id", ""),
                params.get("parent_folder_id", ""),
                params.get("sub_file_index", ""),
            )
            if key in self.ambiguous:
                raise AppError(
                    "engine_creation_ambiguous",
                    409,
                    "上次提交结果尚未确认，请先检查任务列表，避免重复下载。",
                )
            before = set(self.history)
            await self.service.ensure_launcher()
            self.check_mutation_identity(identity)
            payload = {
                "type": task_type,
                "name": name,
                "file_name": name,
                "file_size": "0",
                "space": self.service.api.device_space,
                "params": params,
            }
            try:
                response = await self.service.require_running().create_task(payload)
                raw = response.get("task") or response
                if not isinstance(raw, dict) or not raw.get("id"):
                    raise AppError(
                        "engine_creation_ambiguous",
                        502,
                        "提交结果尚未确认，请先检查任务列表，避免重复下载。",
                    )
                parsed = DriveTask.model_validate(
                    {**payload, **raw, "params": {**params, **raw.get("params", {})}}
                )
            except AppError as error:
                if error.code not in ("engine_unavailable", "engine_creation_ambiguous"):
                    raise
                if isinstance(error.__cause__, (httpx.ConnectError, httpx.ConnectTimeout)):
                    # No HTTP request reached the Runner; a later explicit retry is safe.
                    raise
                self.ambiguous.add(key)
                # Observe only. A transport failure is never permission for another POST.
                for _ in range(3):
                    await asyncio.sleep(0.2)
                    observed = await self.collect(force=True)
                    found = [
                        item
                        for item in observed.tasks
                        if item.id not in before
                        and item.name == name
                        and (
                            item.url == params.get("url")
                            if task_type == "user#download-url"
                            else item.cloud_file_id == params.get("file_id")
                        )
                        and item.folder_id == params.get("parent_folder_id", "")
                        and item.sub_files == params.get("sub_file_index", "")
                    ]
                    if len(found) == 1:
                        self.ambiguous.discard(key)
                        return found[0]
                raise AppError(
                    "engine_creation_ambiguous",
                    502,
                    "提交结果尚未确认，请先检查任务列表，避免重复下载。",
                ) from error
            if self.current_identity() != identity:
                raise AppError(
                    "engine_instance_changed", 409, "下载引擎实例已更改，请检查原实例的任务列表。"
                )
            task = to_download(parsed)
            task.observed_at, task.stale = now(), True
            saved = SavedTask(
                task, "", [], False, DownloadOperation(action="create", status="submitted")
            )
            self.history[task.id] = saved
            await asyncio.to_thread(self.repository.save, identity.key, saved)
            self.invalidate()
            return task

    async def add_links(
        self, urls: list[str], *, name: str, files: list[int] | None, folder_id: str
    ) -> DownloadCreateResponse:
        cleaned = [url.strip() for url in urls if url.strip()]
        results: list[DownloadCreateResult] = []
        for url in cleaned:
            params = {"target": self.service.api.device_space, "url": url}
            if folder_id:
                params["parent_folder_id"] = folder_id
            if files:
                params["sub_file_index"] = compress_indexes(files)
            title = name.strip() if len(cleaned) == 1 and name.strip() else guess_name(url)
            try:
                task = await self._create("user#download-url", title or "download", params)
                results.append(DownloadCreateResult(source=url, ok=True, task_id=task.id))
            except AppError as error:
                results.append(
                    DownloadCreateResult(
                        source=url,
                        ok=False,
                        error=error.message,
                        status="ambiguous"
                        if error.code == "engine_creation_ambiguous"
                        else "failed",
                    )
                )
        return DownloadCreateResponse(results=results)

    async def add_cloud_files(self, ids: list[str], folder_id: str) -> DownloadCreateResponse:
        results: list[DownloadCreateResult] = []
        for file_id in dict.fromkeys(ids):
            try:
                info = await self.service.api.get_file(file_id)
                params = {"target": self.service.api.device_space, "file_id": file_id}
                if folder_id:
                    params["parent_folder_id"] = folder_id
                task = await self._create("user#download", info.name, params)
                results.append(DownloadCreateResult(source=file_id, ok=True, task_id=task.id))
            except AppError as error:
                results.append(
                    DownloadCreateResult(
                        source=file_id,
                        ok=False,
                        error=error.message,
                        status="ambiguous"
                        if error.code == "engine_creation_ambiguous"
                        else "failed",
                    )
                )
        return DownloadCreateResponse(results=results)

    async def retry(self, ids: list[str]) -> DownloadCreateResponse:
        from app.services.engine.service import parse_indexes

        results: list[DownloadCreateResult] = []
        for tid in dict.fromkeys(ids):
            try:
                task = await self.get(tid)
                if not task.capabilities.retry:
                    raise AppError("invalid_request", 409, "当前任务无法重试。")
                if task.source == "cloud":
                    response = await self.add_cloud_files([task.cloud_file_id], task.folder_id)
                else:
                    response = await self.add_links(
                        [task.url],
                        name=task.name,
                        files=parse_indexes(task.sub_files) or None,
                        folder_id=task.folder_id,
                    )
                result = response.results[0].model_copy(update={"source": tid})
                if result.ok:
                    removed = await self.action([tid], "delete")
                    if not removed.ok:
                        result.error = "新任务已创建，旧任务未能移除。"
                results.append(result)
            except AppError as error:
                results.append(
                    DownloadCreateResult(source=tid, ok=False, error=error.message, status="failed")
                )
        return DownloadCreateResponse(results=results)
