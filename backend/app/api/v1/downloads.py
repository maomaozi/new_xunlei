from fastapi import APIRouter, Form, UploadFile

from app.api.deps import EngineDep
from app.api.responses import ENGINE_ERRORS, XUNLEI_ERRORS, errors
from app.api.v1.offline import parse_indexes, read_torrent
from app.schemas.common import OkResponse
from app.schemas.engine import (
    CloudDownloadRequest,
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
        "`user#download-url` / `user#download` tasks of the engine's space with live speed, "
        "local path and acceleration state reported by the engine. `summary` always covers "
        "every task. Access: Public."
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
        "Creates one engine task per magnet/HTTP(S)/FTP/ed2k link (`POST /drive/v1/task`, "
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
        "Progress and speed of the tasks the engine is processing, read from its memory "
        "(`/device/debug`, ~10 ms, no cloud round-trip). The cloud copy of a task is only "
        "patched about once a minute; poll this for live progress. Access: Public."
    ),
    responses=ENGINE_ERRORS,
)
async def live(engine: EngineDep) -> LiveDownloads:
    return await engine.live()


@router.get(
    "/{task_id}",
    response_model=DownloadTask,
    summary="Get engine download",
    description="`GET /drive/v1/tasks/{id}` in the engine space. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def get_download(task_id: str, engine: EngineDep) -> DownloadTask:
    return await engine.get_download(task_id)


@router.post(
    "/pause",
    response_model=OkResponse,
    summary="Pause engine downloads",
    description=(
        '`PATCH /drive/v1/task` with `set_params.spec = {"phase": "pause"}`; tasks that are '
        "not queued or running are skipped. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def pause(body: DownloadIdsRequest, engine: EngineDep) -> OkResponse:
    await engine.set_paused(body.ids, paused=True)
    return OkResponse()


@router.post(
    "/resume",
    response_model=OkResponse,
    summary="Resume engine downloads",
    description="`spec` phase `running` for paused tasks. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def resume(body: DownloadIdsRequest, engine: EngineDep) -> OkResponse:
    await engine.set_paused(body.ids, paused=False)
    return OkResponse()


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
    response_model=OkResponse,
    summary="Delete engine downloads",
    description=(
        "`DELETE /drive/v1/tasks?space=…`; `delete_files` (default from settings) also "
        "removes the downloaded data. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def delete(body: DownloadDeleteRequest, engine: EngineDep) -> OkResponse:
    await engine.delete(body.ids, body.delete_files)
    return OkResponse()
