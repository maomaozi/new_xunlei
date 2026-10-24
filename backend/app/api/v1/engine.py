from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.deps import EngineDep
from app.api.responses import ENGINE_ERRORS
from app.schemas.common import OkResponse
from app.schemas.engine import (
    EngineFolderList,
    EngineLoginLink,
    EngineLoginStatus,
    EngineLogs,
    EngineStatus,
    TrialInfo,
)

router = APIRouter(prefix="/engine", tags=["engine"])


@router.get(
    "",
    response_model=EngineStatus,
    summary="Engine status",
    description=(
        "Process state of the bundled `xunlei-pan-cli` engine, its login (`/device/status` of "
        "the local control API), disks and other runners on this host. Access: Public."
    ),
)
async def status(engine: EngineDep) -> EngineStatus:
    return engine.status()


@router.post(
    "/start",
    response_model=EngineStatus,
    summary="Start engine",
    description="Starts (or adopts) the engine process and its launcher. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def start(engine: EngineDep) -> EngineStatus:
    await engine.start()
    return engine.status()


@router.post(
    "/stop",
    response_model=EngineStatus,
    summary="Stop engine",
    description="Stops the engine; running downloads resume on the next start. Access: Public.",
)
async def stop(engine: EngineDep) -> EngineStatus:
    await engine.stop()
    return engine.status()


@router.post(
    "/restart",
    response_model=EngineStatus,
    summary="Restart engine",
    description="Stops and starts the engine process. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def restart(engine: EngineDep) -> EngineStatus:
    await engine.restart()
    return engine.status()


@router.get(
    "/logs",
    response_model=EngineLogs,
    summary="Engine log tail",
    description="Last lines of `<engine home>/engine.log`. Access: Public.",
)
async def logs(engine: EngineDep, lines: int = Query(default=300, ge=10, le=5000)) -> EngineLogs:
    return engine.logs(lines)


@router.get(
    "/config",
    summary="Engine local config",
    description=(
        "Raw `/device/v1/local_config` of the running engine (speed limit, task count, "
        "download paths). Edit it through `PUT /settings` (section `engine`). Access: Public."
    ),
    responses=ENGINE_ERRORS,
)
async def local_config(engine: EngineDep) -> dict[str, object]:
    engine.require_running()
    return await engine.local_config()


@router.get(
    "/login/qrcode",
    summary="Engine login QR code",
    description=(
        "PNG QR code of the engine's own device-code login (`/auth/qrlogin`). Scan it with the "
        "Xunlei mobile app. Access: Public."
    ),
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **ENGINE_ERRORS},
)
async def login_qrcode(engine: EngineDep) -> Response:
    image = await engine.login_qrcode()
    return Response(content=image, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get(
    "/login/status",
    response_model=EngineLoginStatus,
    summary="Engine login progress",
    description="`/auth/qrlogin/status`: pending until the QR code is confirmed. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def login_status(engine: EngineDep) -> EngineLoginStatus:
    return await engine.login_status()


@router.get(
    "/login/link",
    response_model=EngineLoginLink,
    summary="Engine login link",
    description="Web confirmation link of the pending engine login. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def login_link(engine: EngineDep) -> EngineLoginLink:
    return EngineLoginLink(url=await engine.login_url())


@router.post(
    "/logout",
    response_model=OkResponse,
    summary="Sign the engine out",
    description="`/auth/signout`: the engine forgets its Xunlei login. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def logout(engine: EngineDep) -> OkResponse:
    await engine.logout()
    return OkResponse()


@router.get(
    "/trial",
    response_model=TrialInfo,
    summary="Super speed trial",
    description="`/device/v1/try_speed/get_info` + `get_config`. Access: Public.",
    responses=ENGINE_ERRORS,
)
async def trial(engine: EngineDep) -> TrialInfo:
    return await engine.trial()


@router.post(
    "/trial",
    response_model=TrialInfo,
    summary="Start super speed trial",
    description=(
        "`/device/v1/try_speed/apply`: accelerates running downloads for the trial period; "
        "requires at least one running task and remaining trial count. Access: Public."
    ),
    responses=ENGINE_ERRORS,
)
async def apply_trial(engine: EngineDep) -> TrialInfo:
    return await engine.apply_trial()


@router.get(
    "/folders",
    response_model=EngineFolderList,
    summary="Engine folders",
    description=(
        "Folders of the engine's local space (`GET /drive/v1/files?space=device_id#…`); an "
        "`id` can be passed as `folder_id` when creating downloads. Empty `parent_id` lists "
        "the download roots. Access: Public."
    ),
    responses=ENGINE_ERRORS,
)
async def folders(engine: EngineDep, parent_id: str = "") -> EngineFolderList:
    return await engine.folders(parent_id)
