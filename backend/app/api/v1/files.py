from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.api.deps import ApiDep
from app.api.responses import XUNLEI_ERRORS
from app.core.errors import AppError
from app.schemas.common import OkResponse, TaskRefResponse
from app.schemas.drive import (
    Breadcrumb,
    CreateFolderRequest,
    FileLinkResponse,
    IdsRequest,
    MoveRequest,
    RenameRequest,
    StarRequest,
)
from app.schemas.xunlei import DriveFile, FileList
from app.services.xunlei.api import Category
from app.services.xunlei.http import pin_host

router = APIRouter(prefix="/files", tags=["files"])

PASSTHROUGH_HEADERS = ("content-length", "content-range", "accept-ranges", "last-modified", "etag")


@router.get(
    "",
    response_model=FileList,
    summary="List files",
    description=(
        "`GET /drive/v1/files` excluding trashed items. `parent_id` empty is the root and `*` "
        "searches everywhere (used with category/starred). Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def list_files(
    api: ApiDep,
    parent_id: str = "",
    page_token: str = "",
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
    category: Category | None = None,
    starred: bool | None = None,
) -> FileList:
    return await api.list_files(
        parent_id,
        page_token=page_token,
        limit=limit or api.config.drive.page_size,
        category=category,
        starred=starred,
    )


@router.get(
    "/{file_id}",
    response_model=DriveFile,
    summary="Get file details",
    description="`GET /drive/v1/files/{id}` with hashes, links and media info. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def get_file(file_id: str, api: ApiDep) -> DriveFile:
    return await api.get_file(file_id)


@router.get(
    "/{file_id}/path",
    response_model=list[Breadcrumb],
    summary="Get folder breadcrumbs",
    description="Walks `parent_id` up to the root (max 32 levels). Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def get_path(file_id: str, api: ApiDep) -> list[Breadcrumb]:
    crumbs: list[Breadcrumb] = []
    current = file_id
    for _ in range(32):
        if not current:
            break
        info = await api.get_file(current)
        crumbs.append(Breadcrumb(id=info.id, name=info.name))
        current = info.parent_id
    return list(reversed(crumbs))


@router.get(
    "/{file_id}/link",
    response_model=FileLinkResponse,
    summary="Get download link",
    description=(
        "Returns the VIP CDN link (`web_content_link`) and a same-origin proxy URL. CDN tokens "
        "are bound to the requesting public IP. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def get_link(file_id: str, api: ApiDep) -> FileLinkResponse:
    info, url = await api.download_link(file_id)
    if not url:
        raise AppError("xunlei_error", 409, "该文件暂无可用的下载链接。")
    expire = next((link.expire for link in info.links.values() if link.expire), "")
    return FileLinkResponse(
        url=url,
        proxy_url=f"/api/v1/files/{file_id}/stream",
        expire=expire,
        name=info.name,
        size=info.size,
        mime_type=info.mime_type,
    )


@router.get(
    "/{file_id}/stream",
    summary="Stream file content",
    description=(
        "Proxies the CDN download through this server with Range support, for playback or "
        "browser downloads from networks the CDN token is not bound to. Access: Public."
    ),
    responses={200: {"content": {"application/octet-stream": {}}}, 206: {}, **XUNLEI_ERRORS},
)
async def stream_file(
    file_id: str, request: Request, api: ApiDep, download: bool = False
) -> StreamingResponse:
    info, url = await api.download_link(file_id)
    if not url:
        raise AppError("xunlei_error", 409, "该文件暂无可用的下载链接。")
    network = api.config.network
    target, pinned, extensions = pin_host(httpx.URL(url), network.host_overrides)
    headers = {**pinned, "User-Agent": network.cdn_user_agent}
    if range_header := request.headers.get("range"):
        headers["Range"] = range_header
    upstream_request = api.transfer_http.build_request(
        "GET",
        target,
        headers=headers,
        extensions=extensions,
        timeout=httpx.Timeout(None, connect=network.connect_timeout),
    )
    upstream = await api.transfer_http.send(upstream_request, stream=True)
    if upstream.status_code >= 400:
        await upstream.aclose()
        raise AppError("xunlei_error", 502, f"CDN 返回错误 HTTP {upstream.status_code}。")
    response_headers = {
        k: v for k, v in upstream.headers.items() if k.lower() in PASSTHROUGH_HEADERS
    }
    disposition = "attachment" if download else "inline"
    response_headers["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quote(info.name)}"
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=info.mime_type or "application/octet-stream",
        background=BackgroundTask(upstream.aclose),
    )


@router.post(
    "/folders",
    response_model=DriveFile,
    summary="Create folder",
    description="`POST /drive/v1/files` with kind drive#folder. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def create_folder(body: CreateFolderRequest, api: ApiDep) -> DriveFile:
    return await api.create_folder(body.name, body.parent_id)


@router.patch(
    "/{file_id}",
    response_model=DriveFile,
    summary="Rename file or folder",
    description="`PATCH /drive/v1/files/{id}`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def rename(file_id: str, body: RenameRequest, api: ApiDep) -> DriveFile:
    return await api.rename(file_id, body.name)


@router.post(
    "/move",
    response_model=TaskRefResponse,
    summary="Move files",
    description="`POST /drive/v1/files:batchMove` (asynchronous on Xunlei). Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def move(body: MoveRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchMove", body.ids, body.parent_id))


@router.post(
    "/copy",
    response_model=TaskRefResponse,
    summary="Copy files",
    description="`POST /drive/v1/files:batchCopy` (asynchronous on Xunlei). Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def copy(body: MoveRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchCopy", body.ids, body.parent_id))


@router.post(
    "/trash",
    response_model=TaskRefResponse,
    summary="Move files to trash",
    description="`POST /drive/v1/files:batchTrash`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def trash(body: IdsRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchTrash", body.ids))


@router.post(
    "/delete",
    response_model=TaskRefResponse,
    summary="Delete files permanently",
    description="`POST /drive/v1/files:batchDelete`, bypassing the trash. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def delete(body: IdsRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchDelete", body.ids))


@router.post(
    "/star",
    response_model=OkResponse,
    summary="Star or unstar files",
    description="`POST /drive/v1/files:star` / `files:unstar`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def star(body: StarRequest, api: ApiDep) -> OkResponse:
    await api.set_starred(body.ids, body.starred)
    return OkResponse()
