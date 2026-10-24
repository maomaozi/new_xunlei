from fastapi import APIRouter, Form, UploadFile

from app.api.deps import ApiDep
from app.api.responses import XUNLEI_ERRORS, errors
from app.core.errors import AppError
from app.schemas.common import OkResponse
from app.schemas.drive import (
    DeleteTasksRequest,
    OfflineCreateRequest,
    OfflineCreateResponse,
    OfflineCreateResult,
    ResourcePreview,
    ResourceRequest,
    TaskPhaseFilter,
    TorrentFile,
    TorrentPreview,
)
from app.schemas.xunlei import DriveTask, ResourceNode, TaskList
from app.services.xunlei.api import ALL_PHASES, XunleiApi
from app.services.xunlei.links import guess_name
from app.services.xunlei.torrent import TorrentError, TorrentInfo, parse_torrent

router = APIRouter(prefix="/offline", tags=["offline"])

PHASES: dict[TaskPhaseFilter, str] = {
    "all": ALL_PHASES,
    "running": "PHASE_TYPE_PENDING,PHASE_TYPE_RUNNING",
    "complete": "PHASE_TYPE_COMPLETE",
    "error": "PHASE_TYPE_ERROR",
}
MAX_TORRENT_BYTES = 8 * 1024 * 1024


async def read_torrent(file: UploadFile) -> TorrentInfo:
    data = await file.read(MAX_TORRENT_BYTES + 1)
    if len(data) > MAX_TORRENT_BYTES:
        raise AppError("invalid_request", 400, "种子文件过大。")
    try:
        return parse_torrent(data)
    except TorrentError as error:
        raise AppError("invalid_request", 400, "无法解析该种子文件。") from error


async def _torrent(file: UploadFile) -> TorrentPreview:
    info = await read_torrent(file)
    return TorrentPreview(
        info_hash=info.info_hash,
        name=info.name,
        total_size=info.total_size,
        magnet=info.magnet,
        files=[TorrentFile(index=f.index, path=f.path, size=f.size) for f in info.files],
    )


def _leaves(nodes: list[ResourceNode], prefix: str = "") -> list[TorrentFile]:
    files: list[TorrentFile] = []
    for node in nodes:
        path = f"{prefix}{node.name}"
        if node.is_dir:
            files.extend(_leaves(node.dir.resources if node.dir else [], f"{path}/"))
        else:
            files.append(TorrentFile(index=node.file_index, path=path, size=node.file_size))
    return files


def resource_preview(nodes: list[ResourceNode]) -> ResourcePreview:
    """Flatten the resource tree; a single BT root folder becomes the preview name."""
    if len(nodes) == 1 and nodes[0].is_dir:
        root = nodes[0]
        files = _leaves(root.dir.resources if root.dir else [])
        return ResourcePreview(name=root.name, total_size=root.file_size, files=files)
    files = _leaves(nodes)
    name = nodes[0].name if len(nodes) == 1 else ""
    return ResourcePreview(name=name, total_size=sum(f.size for f in files), files=files)


def parse_indexes(raw: str | None) -> list[int] | None:
    if raw is None or not raw.strip():
        return None
    try:
        indexes = [int(part) for part in raw.split(",") if part.strip()]
    except ValueError as error:
        raise AppError("invalid_request", 400, "文件序号格式不正确。") from error
    if not indexes or min(indexes) < 0:
        raise AppError("invalid_request", 400, "文件序号格式不正确。")
    return indexes


async def _create_many(api: XunleiApi, body: OfflineCreateRequest) -> OfflineCreateResponse:
    parent = body.parent_id if body.parent_id is not None else api.config.offline.default_parent_id
    results: list[OfflineCreateResult] = []
    for raw in body.urls:
        url = raw.strip()
        if not url:
            continue
        name = body.name if len(body.urls) == 1 and body.name else guess_name(url)
        try:
            task = await api.offline_add(url, name, parent, body.files)
            results.append(OfflineCreateResult(url=url, ok=True, task=task))
        except AppError as error:
            results.append(OfflineCreateResult(url=url, ok=False, error=error.message))
    return OfflineCreateResponse(results=results)


@router.get(
    "/tasks",
    response_model=TaskList,
    summary="List cloud download tasks",
    description="`GET /drive/v1/tasks?type=offline` with a phase filter. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def list_tasks(api: ApiDep, phase: TaskPhaseFilter = "all", page_token: str = "") -> TaskList:
    return await api.list_tasks(task_type="offline", phases=PHASES[phase], page_token=page_token)


@router.post(
    "/tasks",
    response_model=OfflineCreateResponse,
    summary="Create cloud download tasks",
    description=(
        "Cloud add (云添加) via `POST /drive/v1/files` with `UPLOAD_TYPE_URL`. Each URL is "
        "submitted separately; failures are reported per URL. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def create_tasks(body: OfflineCreateRequest, api: ApiDep) -> OfflineCreateResponse:
    return await _create_many(api, body)


@router.post(
    "/resources",
    response_model=ResourcePreview,
    summary="List link sub-files",
    description=(
        "`POST /drive/v1/resource/list` with a signed `X-Captcha-Token` (`captcha_sign` from "
        "`/v1/shield/captcha/init`). Returns the flattened files of a magnet/BT link with the "
        "`index` values accepted by `files` when creating tasks. Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(403)},
)
async def list_resources(body: ResourceRequest, api: ApiDep) -> ResourcePreview:
    resources = await api.list_resources(body.url.strip())
    if not resources.page.resources:
        raise AppError("not_found", 404, "迅雷未能解析该链接的文件列表。")
    return resource_preview(resources.page.resources)


@router.post(
    "/torrent/parse",
    response_model=TorrentPreview,
    summary="Parse torrent file",
    description="Decodes a .torrent locally and returns its magnet link and files. Access: Public.",
    responses=errors(400, 422),
)
async def parse(file: UploadFile) -> TorrentPreview:
    return await _torrent(file)


@router.post(
    "/torrent",
    response_model=OfflineCreateResponse,
    summary="Create task from torrent file",
    description=(
        "Converts the .torrent into a magnet link and submits a cloud add. `files` is an "
        "optional comma separated list of sub-file indexes to download. Access: Public."
    ),
    responses={**XUNLEI_ERRORS, **errors(400, 422)},
)
async def create_from_torrent(
    file: UploadFile,
    api: ApiDep,
    parent_id: str | None = Form(default=None),
    files: str | None = Form(default=None),
) -> OfflineCreateResponse:
    preview = await _torrent(file)
    body = OfflineCreateRequest(
        urls=[preview.magnet],
        parent_id=parent_id,
        name=preview.name,
        files=parse_indexes(files),
    )
    return await _create_many(api, body)


@router.get(
    "/tasks/{task_id}",
    response_model=DriveTask,
    summary="Get task",
    description="`GET /drive/v1/tasks/{id}`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def get_task(task_id: str, api: ApiDep) -> DriveTask:
    return await api.get_task(task_id)


@router.post(
    "/tasks/delete",
    response_model=OkResponse,
    summary="Delete cloud tasks",
    description="`DELETE /drive/v1/tasks?task_ids=...&delete_files=...`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def delete_tasks(body: DeleteTasksRequest, api: ApiDep) -> OkResponse:
    delete_files = body.delete_files
    if delete_files is None:
        delete_files = api.config.offline.delete_files_with_task
    await api.delete_tasks(body.ids, delete_files=delete_files)
    return OkResponse()
