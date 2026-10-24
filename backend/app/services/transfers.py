"""Server-side transfer queue between this host and Xunlei Pan.

Downloads mirror `commands.Download` of xunlei-pan-cli (temporary file, HTTP Range
resume, atomic rename) and add multi-connection segments. Uploads mirror
`commands.doUploadFile`: GCID instant upload first, then Aliyun OSS with STS.
Link and torrent downloads run in the bundled Xunlei engine instead (`app.services.engine`).
"""

import asyncio
import logging
import os
import re
import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.core.errors import AppError
from app.repositories.transfers import (
    FINISHED_STATUSES,
    TransferKind,
    TransferRow,
    TransfersRepository,
    TransferStatus,
    now_iso,
)
from app.schemas.settings import AppSettings
from app.services.xunlei.api import XunleiApi
from app.services.xunlei.gcid import calc_gcid
from app.services.xunlei.http import pin_host
from app.services.xunlei.oss import OssError, OssTarget, multipart_upload, put_object

logger = logging.getLogger(__name__)

PARTIAL_SUFFIX = ".xltd"
FLUSH_INTERVAL = 1.0
KIND_PREFIXES: dict[str, TransferKind] = {"d": "download", "u": "upload"}
INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_name(name: str) -> str:
    cleaned = INVALID_NAME_CHARS.sub("_", name).strip().strip(".")
    return cleaned or "unnamed"


class SpeedMeter:
    def __init__(self, window: float = 3.0) -> None:
        self.window = window
        self.samples: deque[tuple[float, int]] = deque()

    def add(self, amount: int) -> None:
        now = time.monotonic()
        self.samples.append((now, amount))
        while self.samples and now - self.samples[0][0] > self.window:
            self.samples.popleft()

    @property
    def rate(self) -> float:
        now = time.monotonic()
        while self.samples and now - self.samples[0][0] > self.window:
            self.samples.popleft()
        if not self.samples:
            return 0.0
        span = max(now - self.samples[0][0], 0.5)
        return sum(n for _, n in self.samples) / span


class RateLimiter:
    """Global token bucket shared by all download connections."""

    def __init__(self) -> None:
        self.rate = 0
        self.tokens = 0.0
        self.updated = time.monotonic()
        self.lock = asyncio.Lock()

    def configure(self, kbps: int) -> None:
        self.rate = kbps * 1024

    async def consume(self, amount: int) -> None:
        if self.rate <= 0:
            return
        async with self.lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.rate, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= amount or self.tokens >= self.rate:
                    self.tokens -= amount
                    return
                await asyncio.sleep((amount - self.tokens) / self.rate)


@dataclass
class Runtime:
    done: int = 0
    phase: str = ""
    meter: SpeedMeter = field(default_factory=SpeedMeter)
    segments: list[list[int]] = field(default_factory=list)
    cancelled: bool = False


class TransferManager:
    def __init__(self, repository: TransfersRepository, api: XunleiApi, data_dir: Path) -> None:
        self.repo = repository
        self.api = api
        self.data_dir = data_dir
        self.limiter = RateLimiter()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._runtime: dict[str, Runtime] = {}
        self._wake = asyncio.Event()
        self._loop_task: asyncio.Task[None] | None = None
        self._folder_locks: dict[str, asyncio.Lock] = {}
        self._folder_cache: dict[tuple[str, tuple[str, ...]], str] = {}

    @property
    def config(self) -> AppSettings:
        return self.api.config

    @property
    def upload_temp_dir(self) -> Path:
        configured = self.config.upload.temp_dir.strip()
        path = Path(configured).expanduser() if configured else self.data_dir / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        resumed: TransferStatus = "queued" if self.config.download.auto_resume else "paused"
        self.repo.set_status_where(("running",), resumed)
        self._loop_task = asyncio.create_task(self._loop(), name="transfer-loop")

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
        tasks = list(self._tasks.values())
        for state in self._runtime.values():
            state.cancelled = True
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._loop_task:
            await asyncio.gather(self._loop_task, return_exceptions=True)
        # Interrupted jobs resume (or stay paused) on the next start.
        self.repo.set_status_where(("running",), "queued")

    def on_settings_changed(self, value: AppSettings) -> None:
        self.limiter.configure(value.download.speed_limit_kbps)
        self._wake.set()

    async def _loop(self) -> None:
        self.limiter.configure(self.config.download.speed_limit_kbps)
        last_flush = 0.0
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=FLUSH_INTERVAL)
            except TimeoutError:
                pass
            self._wake.clear()
            self._schedule("download", self.config.download.max_concurrent)
            self._schedule("upload", self.config.upload.max_concurrent)
            if time.monotonic() - last_flush >= FLUSH_INTERVAL:
                self._flush()
                last_flush = time.monotonic()

    def _schedule(self, kind: TransferKind, limit: int) -> None:
        running = [tid for tid, task in self._tasks.items() if self._kind_of(tid) == kind]
        free = limit - len(running)
        if free <= 0:
            return
        for row in self.repo.next_queued(kind, set(self._tasks), free):
            self._runtime[row.id] = Runtime(done=row.done_bytes)
            self.repo.update(row.id, status="running", error="")
            runner = self._run_download if kind == "download" else self._run_upload
            task = asyncio.create_task(self._guard(row.id, runner), name=f"transfer-{row.id}")
            self._tasks[row.id] = task

    def _kind_of(self, transfer_id: str) -> TransferKind:
        return KIND_PREFIXES.get(transfer_id[:1], "upload")

    def _flush(self) -> None:
        for tid, state in list(self._runtime.items()):
            if tid not in self._tasks:
                continue
            row = self.repo.get(tid)
            if row is None:
                continue
            meta = row.meta
            if state.segments:
                meta = {**meta, "segments": state.segments}
            self.repo.update(tid, done_bytes=state.done, phase=state.phase, meta=meta)

    async def _guard(
        self, transfer_id: str, runner: Callable[[TransferRow], Awaitable[None]]
    ) -> None:
        state = self._runtime[transfer_id]
        try:
            row = self.repo.get(transfer_id)
            if row is None:
                return
            await runner(row)
            self._finish(transfer_id, "completed")
        except asyncio.CancelledError:
            # Pause/cancel/delete set the final status themselves.
            self._persist_progress(transfer_id, state)
        except AppError as error:
            self._finish(transfer_id, "failed", error.message)
        except Exception as error:
            logger.exception("Transfer %s failed", transfer_id)
            self._finish(transfer_id, "failed", _describe(error))
        finally:
            self._tasks.pop(transfer_id, None)
            self._runtime.pop(transfer_id, None)
            self._wake.set()

    def _persist_progress(self, transfer_id: str, state: Runtime) -> None:
        row = self.repo.get(transfer_id)
        if row is None:
            return
        meta = {**row.meta, "segments": state.segments} if state.segments else row.meta
        self.repo.update(transfer_id, done_bytes=state.done, phase=state.phase, meta=meta)

    def _finish(self, transfer_id: str, status: TransferStatus, error: str = "") -> None:
        state = self._runtime.get(transfer_id)
        row = self.repo.get(transfer_id)
        if row is None or state is None:
            return
        meta = dict(row.meta)
        meta.pop("segments", None)
        if state.segments and status != "completed":
            meta["segments"] = state.segments
        done = row.size if status == "completed" and row.size else state.done
        self.repo.update(
            transfer_id,
            status=status,
            error=error,
            done_bytes=done,
            phase=state.phase,
            meta=meta,
            finished_at=now_iso(),
        )

    # ------------------------------------------------------------------- queries

    def runtime(self, transfer_id: str) -> Runtime | None:
        return self._runtime.get(transfer_id)

    def list_rows(self, kind: TransferKind | None = None) -> list[TransferRow]:
        rows = self.repo.list_rows(kind=kind)
        for row in rows:
            state = self._runtime.get(row.id)
            if state:
                row.done_bytes = state.done
                row.phase = state.phase or row.phase
        return rows

    def require(self, transfer_id: str) -> TransferRow:
        row = self.repo.get(transfer_id)
        if row is None:
            raise AppError("transfer_not_found", 404)
        return row

    # ------------------------------------------------------------------- control

    async def _stop_task(self, transfer_id: str) -> None:
        task = self._tasks.get(transfer_id)
        state = self._runtime.get(transfer_id)
        if state:
            state.cancelled = True
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def pause(self, transfer_id: str) -> None:
        row = self.require(transfer_id)
        if row.status not in ("queued", "running"):
            raise AppError("invalid_transfer_state", 409)
        await self._stop_task(transfer_id)
        self.repo.update(transfer_id, status="paused")

    async def resume(self, transfer_id: str) -> None:
        row = self.require(transfer_id)
        if row.status not in ("paused", "failed", "canceled"):
            raise AppError("invalid_transfer_state", 409)
        self.repo.update(transfer_id, status="queued", error="", finished_at="")
        self._wake.set()

    async def cancel(self, transfer_id: str) -> None:
        row = self.require(transfer_id)
        if row.status in FINISHED_STATUSES:
            raise AppError("invalid_transfer_state", 409)
        await self._stop_task(transfer_id)
        self.repo.update(transfer_id, status="canceled", finished_at=now_iso())

    async def delete(self, transfer_ids: list[str], delete_files: bool) -> None:
        for transfer_id in transfer_ids:
            row = self.repo.get(transfer_id)
            if row is None:
                continue
            await self._stop_task(transfer_id)
            if row.kind == "download":
                _unlink(Path(row.local_path + PARTIAL_SUFFIX))
                if delete_files and row.status == "completed":
                    _unlink(Path(row.local_path))
            elif row.meta.get("temp"):
                _unlink(Path(row.local_path))
        self.repo.delete(transfer_ids)

    async def pause_all(self) -> None:
        for row in self.repo.list_rows(statuses=("queued", "running")):
            current = self.repo.get(row.id)
            if current and current.status in ("queued", "running"):
                await self.pause(row.id)

    async def resume_all(self) -> None:
        for row in self.repo.list_rows(statuses=("paused", "failed")):
            current = self.repo.get(row.id)
            if current and current.status in ("paused", "failed"):
                await self.resume(row.id)

    async def clear_finished(self) -> None:
        rows = self.repo.list_rows(statuses=("completed", "canceled"))
        await self.delete([r.id for r in rows], delete_files=False)

    # --------------------------------------------------------------- enqueueing

    def _target_dir(self, override: str | None) -> Path:
        base = Path(override or self.config.download.directory).expanduser()
        base.mkdir(parents=True, exist_ok=True)
        return base

    async def enqueue_downloads(self, file_ids: list[str], directory: str | None) -> int:
        base = self._target_dir(directory)
        rows: list[TransferRow] = []
        for file_id in file_ids:
            await self._collect_downloads(file_id, base, None, rows)
        if rows:
            self.repo.insert_many(rows)
            self._wake.set()
        return len(rows)

    async def _collect_downloads(
        self,
        file_id: str,
        base: Path,
        group: tuple[str, str] | None,
        rows: list[TransferRow],
    ) -> None:
        """Expand a cloud file or folder; `group` (id, name) overrides per-folder groups."""
        info = await self.api.get_file(file_id)
        if info.is_folder:
            group_id, group_name = group or (uuid.uuid4().hex[:10], info.name)
            root = base / safe_name(info.name) if self.config.download.preserve_tree else base
            await self._collect_folder(info.id, root, base, group_id, group_name, rows)
        else:
            group_id, group_name = group or ("", "")
            rows.append(
                self._download_row(info.id, info.name, info.size, base, group_id, group_name)
            )

    async def _collect_folder(
        self,
        folder_id: str,
        local_dir: Path,
        base: Path,
        group: str,
        group_name: str,
        rows: list[TransferRow],
    ) -> None:
        page_token = ""
        while True:
            listing = await self.api.list_files(folder_id, page_token=page_token, limit=500)
            for item in listing.files:
                if item.is_folder:
                    child = local_dir / safe_name(item.name)
                    target = child if self.config.download.preserve_tree else base
                    await self._collect_folder(item.id, target, base, group, group_name, rows)
                else:
                    rows.append(
                        self._download_row(
                            item.id, item.name, item.size, local_dir, group, group_name
                        )
                    )
            page_token = listing.next_page_token
            if not page_token:
                return

    def _download_row(
        self, file_id: str, name: str, size: int, directory: Path, group: str, group_name: str
    ) -> TransferRow:
        return TransferRow(
            id=f"d{uuid.uuid4().hex}",
            kind="download",
            status="queued",
            name=name,
            file_id=file_id,
            local_path=str(directory / safe_name(name)),
            size=size,
            group_id=group,
            group_name=group_name,
        )

    def enqueue_local_upload(self, source: Path, parent_id: str) -> int:
        rows: list[TransferRow] = []
        if source.is_dir():
            group = uuid.uuid4().hex[:10]
            for root, _dirs, files in os.walk(source):
                rel = Path(root).relative_to(source.parent)
                for name in sorted(files):
                    path = Path(root) / name
                    rows.append(
                        self._upload_row(
                            path, name, parent_id, list(rel.parts), False, group, source.name
                        )
                    )
        else:
            rows.append(self._upload_row(source, source.name, parent_id, [], False, "", ""))
        if rows:
            self.repo.insert_many(rows)
            self._wake.set()
        return len(rows)

    def enqueue_temp_upload(
        self, path: Path, name: str, parent_id: str, relative_dir: list[str], group: str
    ) -> TransferRow:
        row = self._upload_row(
            path,
            name,
            parent_id,
            relative_dir,
            True,
            group,
            relative_dir[0] if relative_dir else "",
        )
        self.repo.insert_many([row])
        self._wake.set()
        return row

    def _upload_row(
        self,
        path: Path,
        name: str,
        parent_id: str,
        relative_dir: list[str],
        temp: bool,
        group: str,
        group_name: str,
    ) -> TransferRow:
        return TransferRow(
            id=f"u{uuid.uuid4().hex}",
            kind="upload",
            status="queued",
            name=name,
            parent_id=parent_id,
            local_path=str(path),
            size=path.stat().st_size,
            group_id=group,
            group_name=group_name,
            meta={"relative_dir": relative_dir, "temp": temp},
        )

    # ------------------------------------------------------------------ downloads

    def _resolve_target(self, row: TransferRow) -> Path | None:
        """Apply the conflict policy once; returns None when the file is skipped."""
        final = Path(row.local_path)
        if row.meta.get("resolved"):
            return final
        final.parent.mkdir(parents=True, exist_ok=True)
        policy = self.config.download.conflict
        if final.exists():
            if policy == "skip":
                return None
            if policy == "rename":
                stem, suffix, index = final.stem, final.suffix, 1
                while final.exists() or Path(str(final) + PARTIAL_SUFFIX).exists():
                    final = final.with_name(f"{stem} ({index}){suffix}")
                    index += 1
        self.repo.update(row.id, local_path=str(final), meta={**row.meta, "resolved": True})
        row.local_path = str(final)
        row.meta["resolved"] = True
        return final

    async def _run_download(self, row: TransferRow) -> None:
        state = self._runtime[row.id]
        settings = self.config.download
        state.phase = "resolving"
        final = self._resolve_target(row)
        if final is None:
            state.phase = "skipped"
            return
        info, url = await self.api.download_link(row.file_id)
        if not url:
            raise AppError("xunlei_error", 502, "未能获取下载直链（文件可能违规或尚未就绪）。")
        size = info.size
        if size != row.size:
            self.repo.update(row.id, size=size)
            row.size = size
        partial = Path(str(final) + PARTIAL_SUFFIX)
        if size == 0:
            final.touch()
            return
        segments = _load_segments(row.meta.get("segments"), size)
        if not segments or not partial.exists():
            count = max(
                1, min(settings.connections_per_file, size // (settings.min_segment_mb << 20))
            )
            step = -(-size // count)
            segments = [[start, min(start + step, size) - 1, 0] for start in range(0, size, step)]
            await asyncio.to_thread(_preallocate, partial, size)
        state.segments = segments
        state.done = sum(seg[2] for seg in segments)
        state.phase = "downloading"
        fd = await asyncio.to_thread(os.open, partial, os.O_WRONLY)
        link = {"url": url}
        try:
            await asyncio.gather(
                *(
                    self._download_segment(row, state, fd, seg, link)
                    for seg in segments
                    if seg[2] < seg[1] - seg[0] + 1
                )
            )
        finally:
            await asyncio.to_thread(os.close, fd)
        state.phase = "finalizing"
        await asyncio.to_thread(os.replace, partial, final)
        state.segments = []
        state.phase = "done"

    async def _download_segment(
        self, row: TransferRow, state: Runtime, fd: int, seg: list[int], link: dict[str, str]
    ) -> None:
        settings = self.config.download
        network = self.config.network
        attempts = settings.retry_count + 1
        chunk_size = settings.chunk_kb * 1024
        for attempt in range(attempts):
            start = seg[0] + seg[2]
            end = seg[1]
            if start > end:
                return
            target, pinned, extensions = pin_host(httpx.URL(link["url"]), network.host_overrides)
            headers = {
                **pinned,
                "User-Agent": network.cdn_user_agent,
                "Range": f"bytes={start}-{end}",
            }
            try:
                request = self.api.transfer_http.build_request(
                    "GET",
                    target,
                    headers=headers,
                    extensions=extensions,
                    timeout=httpx.Timeout(
                        network.request_timeout * 2, connect=network.connect_timeout
                    ),
                )
                response = await self.api.transfer_http.send(request, stream=True)
                try:
                    if response.status_code in (403, 410):
                        raise _LinkExpired
                    if response.status_code == 200 and start != 0:
                        raise AppError("xunlei_error", 502, "下载服务器不支持断点续传。")
                    if response.status_code not in (200, 206):
                        raise httpx.HTTPStatusError(
                            f"HTTP {response.status_code}", request=request, response=response
                        )
                    async for chunk in response.aiter_bytes(chunk_size):
                        if state.cancelled:
                            raise asyncio.CancelledError
                        remaining = end - (seg[0] + seg[2]) + 1
                        if remaining <= 0:
                            break
                        chunk = chunk[:remaining]
                        await self.limiter.consume(len(chunk))
                        offset = seg[0] + seg[2]
                        await asyncio.to_thread(os.pwrite, fd, chunk, offset)
                        seg[2] += len(chunk)
                        state.done += len(chunk)
                        state.meter.add(len(chunk))
                finally:
                    await response.aclose()
                if seg[0] + seg[2] > end:
                    return
            except _LinkExpired:
                _, link["url"] = await self.api.download_link(row.file_id)
            except (httpx.HTTPError, OSError) as error:
                if attempt >= attempts - 1:
                    raise AppError(
                        "xunlei_unreachable", 503, f"下载中断：{_describe(error)}"
                    ) from error
                logger.warning("Download %s segment retry %d: %r", row.id, attempt + 1, error)
                await asyncio.sleep(min(2**attempt, 30))
                if attempt >= 1:
                    # Repeated failures usually mean a bad CDN node; a fresh link may route
                    # to another one.
                    try:
                        _, link["url"] = await self.api.download_link(row.file_id)
                    except AppError:
                        pass
        if seg[0] + seg[2] <= seg[1]:
            raise AppError("xunlei_unreachable", 503, "下载多次重试后仍未完成。")

    # -------------------------------------------------------------------- uploads

    async def _cloud_parent(self, parent_id: str, relative_dir: list[str]) -> str:
        if not relative_dir:
            return parent_id
        key = (parent_id, tuple(relative_dir))
        lock = self._folder_locks.setdefault(parent_id, asyncio.Lock())
        async with lock:
            cached = self._folder_cache.get(key)
            if cached:
                return cached
            folder_id = await self.api.ensure_folder_path(parent_id, relative_dir)
            self._folder_cache[key] = folder_id
            return folder_id

    async def _run_upload(self, row: TransferRow) -> None:
        state = self._runtime[row.id]
        settings = self.config.upload
        path = Path(row.local_path)
        if not path.is_file():
            raise AppError("path_not_found", 404, "待上传的本机文件不存在或已被移动。")
        stat = path.stat()
        fingerprint = f"{stat.st_size}:{stat.st_mtime_ns}"
        gcid = str(row.meta.get("gcid") or "")
        if not gcid or row.meta.get("fingerprint") != fingerprint:
            state.phase = "hashing"
            state.done = 0

            def on_hash(done: int) -> None:
                state.done = done

            gcid = await asyncio.to_thread(calc_gcid, path, on_hash, lambda: state.cancelled)
            row.meta.update(gcid=gcid, fingerprint=fingerprint)
            self.repo.update(row.id, meta=row.meta, size=stat.st_size)
        state.phase = "creating"
        if await self._previous_attempt_completed(row):
            state.phase = "done"
            state.done = stat.st_size
            self._cleanup_temp(row)
            return
        relative = row.meta.get("relative_dir")
        parent = await self._cloud_parent(
            row.parent_id, [str(p) for p in relative] if isinstance(relative, list) else []
        )
        response = await self.api.create_upload(row.name, parent, stat.st_size, gcid)
        file_info = response.get("file") or {}
        file_id = str(file_info.get("id") or "")
        if file_id:
            self.repo.update(row.id, file_id=file_id)
        if (file_info.get("phase") or response.get("phase")) == "PHASE_TYPE_COMPLETE":
            state.phase = "instant"
            state.done = stat.st_size
            self.repo.update(row.id, meta={**row.meta, "instant": True})
            self._cleanup_temp(row)
            return
        if settings.instant_only:
            raise AppError("xunlei_error", 409, "云端未命中秒传，已按设置跳过实际上传。")
        resumable = response.get("resumable") or {}
        params = resumable.get("params") if isinstance(resumable, dict) else None
        if not params:
            params = (response.get("upload_param") or {}).get("upload_resumable")
        if not isinstance(params, dict):
            raise AppError("xunlei_error", 502, "服务端未返回上传凭据。")
        try:
            target = OssTarget.from_params(params)
        except OssError as error:
            raise AppError("xunlei_error", 502, "服务端返回的上传凭据不完整。") from error
        state.phase = "uploading"
        state.done = 0

        def on_bytes(amount: int) -> None:
            state.done = max(0, state.done + amount)
            if amount > 0:
                state.meter.add(amount)

        try:
            if stat.st_size > settings.multipart_threshold_mb << 20:
                await multipart_upload(
                    self.api.transfer_http,
                    target,
                    path,
                    settings.part_size_mb << 20,
                    settings.part_concurrency,
                    on_bytes,
                    lambda: state.cancelled,
                    settings.retry_count,
                )
            else:
                for attempt in range(settings.retry_count + 1):
                    before = state.done
                    try:
                        await put_object(
                            self.api.transfer_http, target, path, on_bytes, lambda: state.cancelled
                        )
                        break
                    except (httpx.HTTPError, OssError) as error:
                        state.done = before
                        if attempt >= settings.retry_count:
                            raise
                        logger.warning("Retrying OSS upload %s: %r", row.id, error)
                        await asyncio.sleep(1 + attempt)
        except OssError as error:
            raise AppError("xunlei_error", 502, str(error)) from error
        except httpx.HTTPError as error:
            raise AppError("xunlei_unreachable", 503, f"上传中断：{_describe(error)}") from error
        state.phase = "done"
        self._cleanup_temp(row)

    async def _previous_attempt_completed(self, row: TransferRow) -> bool:
        """Check the cloud entry created by an interrupted previous attempt.

        A completed entry means the upload already landed. An incomplete one is removed,
        otherwise Xunlei keeps an empty PENDING file and names the retry "x(1)".
        """
        if not row.file_id:
            return False
        try:
            previous = await self.api.get_file(row.file_id)
            if previous.phase == "PHASE_TYPE_COMPLETE" and not previous.trashed:
                return True
            await self.api.batch("batchDelete", [row.file_id])
        except AppError:
            pass
        self.repo.update(row.id, file_id="")
        row.file_id = ""
        return False

    def _cleanup_temp(self, row: TransferRow) -> None:
        if row.meta.get("temp") and self.config.upload.delete_temp_after:
            _unlink(Path(row.local_path))


class _LinkExpired(Exception):
    pass


def _load_segments(raw: object, size: int) -> list[list[int]]:
    if not isinstance(raw, list) or not raw:
        return []
    segments: list[list[int]] = []
    for item in raw:
        if not (
            isinstance(item, list) and len(item) == 3 and all(isinstance(v, int) for v in item)
        ):
            return []
        segments.append([int(v) for v in item])
    if segments[-1][1] != size - 1:
        return []
    return segments


def _preallocate(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Failed to remove %s", path)


def _describe(error: BaseException) -> str:
    text = str(error).strip()
    return f"{type(error).__name__}: {text}" if text else type(error).__name__
