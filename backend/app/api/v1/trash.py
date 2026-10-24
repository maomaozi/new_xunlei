from fastapi import APIRouter

from app.api.deps import ApiDep
from app.api.responses import XUNLEI_ERRORS
from app.schemas.common import TaskRefResponse
from app.schemas.drive import IdsRequest
from app.schemas.xunlei import FileList

router = APIRouter(prefix="/trash", tags=["trash"])


@router.get(
    "",
    response_model=FileList,
    summary="List trash",
    description="`GET /drive/v1/files` with `trashed=true` across all folders. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def list_trash(api: ApiDep, page_token: str = "") -> FileList:
    return await api.list_files(
        "*", page_token=page_token, limit=api.config.drive.page_size, trashed=True
    )


@router.post(
    "/restore",
    response_model=TaskRefResponse,
    summary="Restore from trash",
    description="`POST /drive/v1/files:batchUntrash`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def restore(body: IdsRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchUntrash", body.ids))


@router.post(
    "/delete",
    response_model=TaskRefResponse,
    summary="Delete trashed files permanently",
    description="`POST /drive/v1/files:batchDelete`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def delete(body: IdsRequest, api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.batch("batchDelete", body.ids))


@router.post(
    "/empty",
    response_model=TaskRefResponse,
    summary="Empty trash",
    description="`PATCH /drive/v1/files/trash:empty`. Irreversible. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def empty(api: ApiDep) -> TaskRefResponse:
    return TaskRefResponse(task_id=await api.empty_trash())
