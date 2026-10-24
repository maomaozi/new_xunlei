import asyncio
import uuid
from pathlib import Path
from typing import BinaryIO

from fastapi import APIRouter, Request

from app.api.deps import TransfersDep
from app.api.responses import XUNLEI_ERRORS, errors
from app.api.v1.system import ensure_allowed
from app.core.errors import AppError
from app.repositories.transfers import TransferKind, TransferRow
from app.schemas.common import OkResponse
from app.schemas.transfers import (
    DownloadRequest,
    EnqueueResponse,
    LocalUploadRequest,
    TransferAction,
    TransferDeleteRequest,
    TransferItem,
    TransferList,
    TransferSummary,
)
from app.services.transfers import TransferManager, safe_name

router = APIRouter(prefix="/transfers", tags=["transfers"])


def to_item(manager: TransferManager, row: TransferRow) -> TransferItem:
    state = manager.runtime(row.id)
    segments = row.meta.get("segments")
    connections = len(state.segments) if state and state.segments else 0
    if not connections and isinstance(segments, list):
        connections = len(segments)
    return TransferItem(
        id=row.id,
        kind=row.kind,
        status=row.status,
        name=row.name,
        file_id=row.file_id,
        parent_id=row.parent_id,
        local_path=row.local_path,
        size=row.size,
        done_bytes=row.done_bytes,
        speed=state.meter.rate if state else 0.0,
        phase=row.phase,
        error=row.error,
        group_id=row.group_id,
        group_name=row.group_name,
        instant=bool(row.meta.get("instant")),
        connections=connections,
        created_at=row.created_at,
        updated_at=row.updated_at,
        finished_at=row.finished_at,
    )


@router.get(
    "",
    response_model=TransferList,
    summary="List local transfers",
    description="Server-side downloads/uploads with live progress and speed. Access: Public.",
)
async def list_transfers(manager: TransfersDep, kind: TransferKind | None = None) -> TransferList:
    items = [to_item(manager, row) for row in manager.list_rows(kind)]
    every = items if kind is None else [to_item(manager, r) for r in manager.list_rows(None)]
    summary = TransferSummary(
        active=sum(i.status in ("queued", "running", "paused") for i in every),
        queued=sum(i.status == "queued" for i in every),
        running=sum(i.status == "running" for i in every),
        paused=sum(i.status == "paused" for i in every),
        failed=sum(i.status == "failed" for i in every),
        completed=sum(i.status == "completed" for i in every),
        download_speed=sum(i.speed for i in every if i.kind == "download"),
        upload_speed=sum(i.speed for i in every if i.kind == "upload"),
    )
    return TransferList(items=items, summary=summary)


@router.post(
    "/downloads",
    response_model=EnqueueResponse,
    summary="Download cloud files to this host",
    description=(
        "Queues files (folders are expanded recursively) into the configured download "
        "directory, with multi-connection Range downloads and resume. Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(422)},
)
async def enqueue_downloads(body: DownloadRequest, manager: TransfersDep) -> EnqueueResponse:
    if body.directory:
        ensure_allowed(Path(body.directory).expanduser(), manager.config.system.browse_roots)
    return EnqueueResponse(count=await manager.enqueue_downloads(body.file_ids, body.directory))


@router.post(
    "/uploads/local",
    response_model=EnqueueResponse,
    summary="Upload a host file or folder",
    description="Queues a file or directory tree that already exists on this host. Access: Public.",
    responses=errors(403, 404, 422),
)
async def enqueue_local(body: LocalUploadRequest, manager: TransfersDep) -> EnqueueResponse:
    path = ensure_allowed(Path(body.path).expanduser(), manager.config.system.browse_roots)
    if not path.exists():
        raise AppError("path_not_found", 404)
    count = await asyncio.to_thread(manager.enqueue_local_upload, path, body.parent_id)
    return EnqueueResponse(count=count)


@router.put(
    "/uploads/stream",
    response_model=TransferItem,
    summary="Upload from the browser",
    description=(
        "Raw request body is stored in the upload temp directory, then queued for GCID "
        "instant upload / OSS upload. `relative_dir` (slash separated) recreates browser "
        "folder uploads under `parent_id`. Access: Public."
    ),
    responses=errors(400, 422),
)
async def upload_stream(
    request: Request,
    manager: TransfersDep,
    name: str,
    parent_id: str = "",
    relative_dir: str = "",
    group: str = "",
) -> TransferItem:
    clean_name = safe_name(name)
    temp = manager.upload_temp_dir / f"{uuid.uuid4().hex}-{clean_name}"
    handle: BinaryIO = await asyncio.to_thread(temp.open, "wb")
    try:
        async for chunk in request.stream():
            await asyncio.to_thread(handle.write, chunk)
    except BaseException:
        await asyncio.to_thread(handle.close)
        temp.unlink(missing_ok=True)
        raise
    await asyncio.to_thread(handle.close)
    expected = request.headers.get("content-length")
    if expected and temp.stat().st_size != int(expected):
        temp.unlink(missing_ok=True)
        raise AppError("invalid_request", 400, "上传数据不完整，请重试。")
    parts = [safe_name(p) for p in relative_dir.split("/") if p.strip()]
    row = manager.enqueue_temp_upload(temp, name, parent_id, parts, group)
    return to_item(manager, row)


@router.post(
    "/bulk/{action}",
    response_model=OkResponse,
    summary="Bulk transfer actions",
    description="`pause-all`, `resume-all` or `clear-finished`. Access: Public.",
    responses=errors(404),
)
async def bulk(action: str, manager: TransfersDep) -> OkResponse:
    if action == "pause-all":
        await manager.pause_all()
    elif action == "resume-all":
        await manager.resume_all()
    elif action == "clear-finished":
        await manager.clear_finished()
    else:
        raise AppError("not_found", 404)
    return OkResponse()


@router.post(
    "/{transfer_id}/{action}",
    response_model=OkResponse,
    summary="Pause, resume or cancel a transfer",
    description="`resume` also retries failed or canceled jobs. Access: Public.",
    responses=errors(404, 409),
)
async def control(transfer_id: str, action: TransferAction, manager: TransfersDep) -> OkResponse:
    if action == "pause":
        await manager.pause(transfer_id)
    elif action == "resume":
        await manager.resume(transfer_id)
    else:
        await manager.cancel(transfer_id)
    return OkResponse()


@router.post(
    "/delete",
    response_model=OkResponse,
    summary="Delete transfer records",
    description=(
        "Stops and removes jobs and partial files; `delete_files` also removes completed "
        "downloaded files. Access: Public."
    ),
)
async def delete(body: TransferDeleteRequest, manager: TransfersDep) -> OkResponse:
    await manager.delete(body.ids, body.delete_files)
    return OkResponse()
