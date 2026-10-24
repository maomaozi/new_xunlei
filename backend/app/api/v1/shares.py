from fastapi import APIRouter

from app.api.deps import ApiDep
from app.api.responses import XUNLEI_ERRORS
from app.schemas.common import OkResponse
from app.schemas.drive import IdsRequest, ShareCreateRequest
from app.schemas.xunlei import EventList, ShareCreated, ShareList

router = APIRouter(prefix="/shares", tags=["shares"])
events_router = APIRouter(prefix="/events", tags=["events"])


@router.get(
    "",
    response_model=ShareList,
    summary="List my shares",
    description="`GET /drive/v1/share/list`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def list_shares(api: ApiDep, page_token: str = "") -> ShareList:
    return await api.list_shares(page_token)


@router.post(
    "",
    response_model=ShareCreated,
    summary="Create share link",
    description="`POST /drive/v1/share`; omitted options fall back to settings. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def create_share(body: ShareCreateRequest, api: ApiDep) -> ShareCreated:
    defaults = api.config.share
    return await api.create_share(
        body.file_ids,
        expiration_days=(
            body.expiration_days if body.expiration_days is not None else defaults.expiration_days
        ),
        pass_code=body.pass_code,
        use_pass_code=(
            body.use_pass_code if body.use_pass_code is not None else defaults.use_pass_code
        ),
        restore_limit=(
            body.restore_limit if body.restore_limit is not None else defaults.restore_limit
        ),
        title=body.title or defaults.title,
    )


@router.post(
    "/delete",
    response_model=OkResponse,
    summary="Cancel shares",
    description="`POST /drive/v1/share:batchDelete`. Shared files are untouched. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def delete_shares(body: IdsRequest, api: ApiDep) -> OkResponse:
    await api.delete_shares(body.ids)
    return OkResponse()


@events_router.get(
    "",
    response_model=EventList,
    summary="List drive activity",
    description="`GET /drive/v1/events` (cloud add, upload, restore...). Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def list_events(api: ApiDep, page_token: str = "") -> EventList:
    return await api.list_events(page_token)
