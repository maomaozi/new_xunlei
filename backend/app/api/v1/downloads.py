from fastapi import APIRouter, Form, UploadFile

from app.api.deps import EngineDep
from app.api.responses import ENGINE_ERRORS, XUNLEI_ERRORS, errors
from app.api.v1.offline import parse_indexes, read_torrent
from app.schemas.engine import (
    CloudDownloadRequest,
    DownloadActionResponse,
    DownloadCreateRequest,
    DownloadCreateResponse,
    DownloadDeleteRequest,
    DownloadFilter,
    DownloadIdsRequest,
    DownloadList,
    DownloadTask,
    LiveDownloads,
)
from app.services.xunlei.links import with_trackers

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get(
    "",
    response_model=DownloadList,
    summary="List engine downloads",
    description=(
        "One versioned Runner snapshot: local database, memory and persisted history, with "
        "optional background cloud enrichment. Filtering happens after merging; summary "
        "covers all tasks. Source failures and stale observations are explicit. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def list_downloads(engine: EngineDep, status: DownloadFilter = "all") -> DownloadList:
    return await engine.list_downloads(status)


@router.post(
    "",
    response_model=DownloadCreateResponse,
    summary="Download links on this host",
    description=(
        "Creates one engine task per magnet/HTTP(S)/FTP/ed2k link via the Runner loopback "
        "proxy (`POST /drive/v1/task`, still dependent on the cloud, "
        "type `user#download-url`). `files` selects BT sub-files (`sub_file_index`), "
        "`folder_id` an engine folder from `GET /engine/folders`. Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(422)},
)
async def create(body: DownloadCreateRequest, engine: EngineDep) -> DownloadCreateResponse:
    return await engine.add_links(
        body.urls, name=body.name, files=body.files, folder_id=body.folder_id
    )


@router.post(
    "/torrent",
    response_model=DownloadCreateResponse,
    summary="Download a torrent on this host",
    description=(
        "Decodes the .torrent locally, converts it to a magnet link with its trackers and "
        "creates an engine task. `files` is an optional comma separated list of sub-file "
        "indexes. Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(400, 422)},
)
async def create_from_torrent(
    file: UploadFile,
    engine: EngineDep,
    files: str | None = Form(default=None),
    folder_id: str = Form(default=""),
    name: str = Form(default=""),
) -> DownloadCreateResponse:
    info = await read_torrent(file)
    return await engine.add_links(
        [with_trackers(info.magnet, info.trackers)],
        name=name or info.name,
        files=parse_indexes(files),
        folder_id=folder_id,
    )


@router.post(
    "/cloud",
    response_model=DownloadCreateResponse,
    summary="Download cloud files on this host",
    description=(
        "Creates `user#download` tasks: the engine pulls each cloud file or folder with VIP "
        "acceleration into `folder_id` (default folder when empty). Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(422)},
)
async def create_cloud(body: CloudDownloadRequest, engine: EngineDep) -> DownloadCreateResponse:
    return await engine.add_cloud_files(body.file_ids, body.folder_id)


@router.get(
    "/live",
    response_model=LiveDownloads,
    summary="Live engine progress",
    description=(
        "Compatibility live response from the same snapshot as list/detail. Contains memory "
        "telemetry and the complete merged downloads collection, version, observation time "
        "and source errors. Cloud enrichment never blocks the local read. Access: Public."
    ),
    responses=ENGINE_ERRORS,
)
async def live(engine: EngineDep) -> LiveDownloads:
    return await engine.live()


@router.get(
    "/{task_id}",
    response_model=DownloadTask,
    summary="Get engine download",
    description="Read a task from the shared snapshot, including local history. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def get_download(task_id: str, engine: EngineDep) -> DownloadTask:
    return await engine.get_download(task_id)


@router.post(
    "/pause",
    response_model=DownloadActionResponse,
    summary="Pause engine downloads",
    description=(
        "Pause through mapped local touch, with configured Runner proxy fallback. Returns "
        "per-task confirmation, timeout, unsupported or failure results; HTTP success alone "
        "does not confirm a state transition. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def pause(body: DownloadIdsRequest, engine: EngineDep) -> DownloadActionResponse:
    return await engine.set_paused(body.ids, paused=True)


@router.post(
    "/resume",
    response_model=DownloadActionResponse,
    summary="Resume engine downloads",
    description=(
        "Resume using local touch or the configured Runner proxy fallback. A confirmed queued "
        "result means scheduling resumed, not that bytes are transferring. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def resume(body: DownloadIdsRequest, engine: EngineDep) -> DownloadActionResponse:
    return await engine.set_paused(body.ids, paused=False)


@router.post(
    "/retry",
    response_model=DownloadCreateResponse,
    summary="Retry failed engine downloads",
    description=(
        "Submits an equivalent task (same link/cloud file, sub-files and folder) and deletes "
        "the failed one without touching downloaded data. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def retry(body: DownloadIdsRequest, engine: EngineDep) -> DownloadCreateResponse:
    return await engine.retry(body.ids)


@router.post(
    "/delete",
    response_model=DownloadActionResponse,
    summary="Delete engine downloads",
    description=(
        "Remove the native task and optionally reconcile cloud persistence. `delete_files` "
        "cleans associated paths inside configured download roots only after local removal "
        "is observed, or cloud deletion succeeds and both live execution and the kernel "
        "mapping are absent. Passive native history is retired with a persisted fingerprint "
        "and reported by `local_history_retained`; the engine database is never edited. "
        "Late confirmation retires history automatically; pending file cleanup remains "
        "retryable. Per-task results distinguish local removal, cloud sync, timeout and "
        "partial file cleanup. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def delete(body: DownloadDeleteRequest, engine: EngineDep) -> DownloadActionResponse:
    return await engine.delete(body.ids, body.delete_files)
