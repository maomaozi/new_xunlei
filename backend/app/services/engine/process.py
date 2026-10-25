"""Lifecycle of the native `xunlei-pan-cli -q run runner` engine process.

`ALLOW_CUSTOM_PLATFORM=true` skips hardware detection (`Detector.DetectPlatform`) so the
binary runs on a plain Linux host as the selected NAS platform; `HOME` selects the engine's
state directory (`.drive`), `DownloadPATH`/`TorrentPath` the default download folders,
`DriveListen` the loopback API and `LauncherAddress` our launcher stand-in.
"""

import asyncio
import json
import logging
import os
import platform
import shutil
import signal
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

BINARY_PREFIX = "xunlei-pan-cli"
LOG_NAME = "engine.log"
PID_NAME = "pan.pid"
INFO_NAME = "info.file"


def host_arch() -> str:
    machine = platform.machine().lower()
    return "arm64" if machine in ("aarch64", "arm64") else "amd64"


def find_binary(configured: str, search_dirs: list[Path]) -> Path | None:
    """The configured binary, else the newest `xunlei-pan-cli*<arch>` in the search dirs."""
    if configured.strip():
        path = Path(configured).expanduser()
        return path if path.is_file() else None
    arch = host_arch()
    for directory in search_dirs:
        try:
            candidates = sorted(
                (p for p in directory.glob(f"{BINARY_PREFIX}*") if p.is_file()),
                key=lambda p: p.name,
                reverse=True,
            )
        except OSError:
            continue
        for candidate in candidates:
            if candidate.name.endswith(arch) or candidate.name == BINARY_PREFIX:
                return candidate
    return None


def binary_version(path: Path) -> str:
    # Release binaries are named xunlei-pan-cli.<version>.<arch>.
    parts = path.name.split(".")
    if len(parts) >= 4 and parts[0] == BINARY_PREFIX:
        return ".".join(parts[1:-1])
    return ""


@dataclass(frozen=True)
class LaunchSpec:
    binary: Path
    home: Path
    platform: str
    nas_id: str
    control_port: int
    public_port: int
    launcher_port: int
    download_dir: Path
    torrent_dir: Path
    device_id: str
    user_id: str
    client_id: str
    client_version: str
    log_max_bytes: int
    device_space: str = ""
    webhook_url: str = ""
    webhook_modules: tuple[tuple[str, tuple[str, ...]], ...] = ()

    @property
    def log_path(self) -> Path:
        return self.home / LOG_NAME

    @property
    def pid_path(self) -> Path:
        return self.home / PID_NAME

    def info(self) -> dict[str, str]:
        return {
            "arch": host_arch(),
            "client_id": self.client_id,
            "client_version": self.client_version,
            "device_id": self.device_id,
            "package_name": f"pan.xunlei.cli.{self.platform}",
            "platform": self.platform,
            "user_id": self.user_id,
        }

    def environment(self) -> dict[str, str]:
        env = {
            key: value
            for key, value in os.environ.items()
            if key in ("PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR")
        }
        env.update(
            {
                "ALLOW_CUSTOM_PLATFORM": "true",
                "PLATFORM": self.platform,
                "DeviceId": self.device_id,
                "NAS_ID": self.nas_id,
                "HOME": str(self.home),
                "DownloadPATH": str(self.download_dir),
                "TorrentPath": str(self.torrent_dir),
                "DriveListen": f"127.0.0.1:{self.control_port}",
                "DrivePublicPort": str(self.public_port),
                "LauncherAddress": f"http://127.0.0.1:{self.launcher_port}",
                "DriveLogLevel": "debug",
            }
        )
        if self.platform in ("linux", "docker"):
            env.pop("LauncherAddress", None)
        if self.platform == "linux":
            if self.device_space:
                env["DeviceSpace"] = self.device_space
            if self.webhook_url and self.webhook_modules:
                modules = ";".join(
                    f"{module}:{','.join(functions)}" for module, functions in self.webhook_modules
                )
                env["Webhook"] = f"{modules} {self.webhook_url}"
        return env


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _cmdline(pid: int) -> list[str]:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return []
    return [part.decode(errors="replace") for part in raw.split(b"\0") if part]


def _environ_home(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return ""
    for part in raw.split(b"\0"):
        if part.startswith(b"HOME="):
            return part[5:].decode(errors="replace")
    return ""


def foreign_engines(own_pid: int | None) -> list[dict[str, object]]:
    """Other xunlei-pan-cli runners on this host (same device id means MQTT kick-outs)."""
    found: list[dict[str, object]] = []
    proc = Path("/proc")
    if not proc.is_dir():
        return found
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == own_pid:
            continue
        args = _cmdline(pid)
        if not args or BINARY_PREFIX not in Path(args[0]).name or "runner" not in args:
            continue
        found.append({"pid": pid, "command": " ".join(args)[:300], "home": _environ_home(pid)})
    return found


class EngineProcess:
    def __init__(self) -> None:
        self._proc: asyncio.subprocess.Process | None = None
        self.pid: int | None = None
        self.started_at: float = 0
        self.last_exit_code: int | None = None
        self.last_exit_at: float = 0
        self.spec: LaunchSpec | None = None

    @property
    def alive(self) -> bool:
        if self._proc is not None:
            return self._proc.returncode is None
        return self.pid is not None and _pid_alive(self.pid)

    def poll(self) -> None:
        """Record the exit of a process that died on its own."""
        if self.pid is None or self.alive:
            return
        if self._proc is not None:
            self.last_exit_code = self._proc.returncode
        self.last_exit_at = time.time()
        logger.warning("Engine process %s exited (code %s)", self.pid, self.last_exit_code)
        self._proc = None
        self.pid = None

    def adopt(self, spec: LaunchSpec) -> bool:
        """Take over an engine left running by a previous backend process."""
        try:
            pid = int(spec.pid_path.read_text().strip())
        except (OSError, ValueError):
            return False
        args = _cmdline(pid)
        if not _pid_alive(pid) or not args or BINARY_PREFIX not in Path(args[0]).name:
            return False
        if _environ_home(pid) not in ("", str(spec.home)):
            return False
        self.pid = pid
        self.spec = spec
        self.started_at = time.time()
        logger.info("Adopted running engine process %d", pid)
        return True

    async def start(self, spec: LaunchSpec) -> None:
        if self.alive:
            return
        await asyncio.to_thread(self._prepare, spec)
        log = await asyncio.to_thread(spec.log_path.open, "ab")
        try:
            self._proc = await asyncio.create_subprocess_exec(
                str(spec.binary),
                "--pid",
                str(spec.pid_path),
                "--info",
                str(spec.home / INFO_NAME),
                "-q",
                "run",
                "runner",
                cwd=str(spec.home),
                env=spec.environment(),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=log,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=True,
            )
        finally:
            log.close()
        self.pid = self._proc.pid
        self.spec = spec
        self.started_at = time.time()
        logger.info("Started engine process %d (%s)", self.pid, spec.binary.name)

    @staticmethod
    def _prepare(spec: LaunchSpec) -> None:
        for directory in (spec.home, spec.download_dir, spec.torrent_dir):
            directory.mkdir(parents=True, exist_ok=True)
        os.chmod(spec.binary, os.stat(spec.binary).st_mode | 0o111)
        (spec.home / INFO_NAME).write_text(json.dumps(spec.info(), separators=(",", ":")))
        log = spec.log_path
        if log.is_file() and log.stat().st_size > spec.log_max_bytes:
            log.replace(log.with_suffix(".log.1"))

    async def stop(self, grace: float = 10) -> None:
        pid = self.pid
        if pid is None or not self.alive:
            self._proc = None
            self.pid = None
            return
        logger.info("Stopping engine process %d", pid)
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + grace
        while self.alive and time.monotonic() < deadline:
            if self._proc is not None:
                try:
                    await asyncio.wait_for(self._proc.wait(), timeout=0.5)
                except TimeoutError:
                    pass
            else:
                await asyncio.sleep(0.3)
        if self.alive:
            logger.warning("Engine process %d did not stop in time; killing it", pid)
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            if self._proc is not None:
                await self._proc.wait()
        self.last_exit_code = self._proc.returncode if self._proc is not None else None
        self.last_exit_at = time.time()
        self._proc = None
        self.pid = None


def rotate_log(path: Path, max_bytes: int) -> bool:
    """Copy-truncate the engine log once it exceeds `max_bytes`.

    The engine writes through an O_APPEND descriptor, so truncating in place is safe while it
    runs (debug logging, needed for the live-state route, grows the log quickly).
    """
    try:
        if path.stat().st_size <= max_bytes:
            return False
        shutil.copyfile(path, path.with_suffix(".log.1"))
        with path.open("r+b") as handle:
            handle.truncate(0)
    except OSError as error:
        logger.warning("Engine log rotation failed: %s", error)
        return False
    return True


def tail_log(path: Path, max_bytes: int) -> list[str]:
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - max_bytes))
            data = handle.read()
    except OSError:
        return []
    lines = data.decode(errors="replace").splitlines()
    return lines[1:] if size > max_bytes and lines else lines
