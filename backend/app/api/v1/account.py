import asyncio
import json
import logging
import time

from fastapi import APIRouter, UploadFile
from pydantic import ValidationError

from app.api.deps import ApiDep
from app.api.responses import XUNLEI_ERRORS, errors
from app.core.errors import AppError
from app.schemas.account import (
    AccountOverview,
    AccountStatus,
    DeviceIdRequest,
    ImportCredentialsRequest,
    PasswordLoginRequest,
    QrLoginPoll,
    QrLoginStart,
    UserProfile,
    VipInfo,
)
from app.schemas.common import OkResponse
from app.services.xunlei.api import XunleiApi
from app.services.xunlei.http import JsonObject

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/account", tags=["account"])

VAS_LABELS = {"5": "超级会员", "3": "白金会员", "2": "白金会员", "1": "普通会员"}


def account_status(api: XunleiApi) -> AccountStatus:
    creds = api.credentials
    return AccountStatus(
        logged_in=api.has_credentials,
        token_valid=bool(creds.access_token) and time.time() < creds.expires_at,
        user_id=creds.user_id,
        device_id=creds.device_id,
        expires_at=creds.expires_at,
        has_refresh_token=bool(creds.refresh_token),
        source=creds.source,
        updated_at=creds.updated_at,
    )


def to_profile(data: JsonObject) -> UserProfile:
    vip = VipInfo()
    infos = data.get("vip_info")
    if isinstance(infos, list) and infos and isinstance(infos[0], dict):
        info = infos[0]
        details = info.get("vip_detail")
        active = next(
            (d for d in details or [] if isinstance(d, dict) and d.get("IsVIP")),
            None,
        )
        icon = info.get("vip_icon")
        vas = str(info.get("vas_type") or "")
        vip = VipInfo(
            is_vip=str(info.get("is_vip")) == "1",
            level=int(info.get("level") or 0),
            vas_type=vas,
            label=VAS_LABELS.get(vas, "会员") if str(info.get("is_vip")) == "1" else "普通用户",
            expire_at=str(info.get("expire_time") or ""),
            surplus_days=int(active.get("SurplusDay") or 0) if active else 0,
            icon=str(icon.get("general") or "") if isinstance(icon, dict) else "",
        )
    return UserProfile(
        id=str(data.get("sub") or data.get("id") or ""),
        name=str(data.get("name") or ""),
        avatar=str(data.get("picture") or ""),
        email=str(data.get("email") or ""),
        phone=str(data.get("phone_number") or ""),
        created_at=str(data.get("created_at") or ""),
        vip=vip,
    )


@router.get(
    "",
    response_model=AccountStatus,
    summary="Get stored credential status",
    description="Local credential state only; does not contact Xunlei. Access: Public.",
)
async def get_status(api: ApiDep) -> AccountStatus:
    return account_status(api)


@router.get(
    "/overview",
    response_model=AccountOverview,
    summary="Get profile, VIP and quota",
    description=(
        "Fetches `GET /v1/user/me` and `GET /drive/v1/about`. When not logged in only the "
        "status is returned. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def overview(api: ApiDep) -> AccountOverview:
    status = account_status(api)
    if not status.logged_in:
        return AccountOverview(status=status)
    me, about = await asyncio.gather(api.user_me(), api.about())
    return AccountOverview(status=account_status(api), profile=to_profile(me), quota=about.quota)


@router.post(
    "/import",
    response_model=AccountStatus,
    summary="Import credentials JSON",
    description=(
        "Imports the project's `credentials.json` (access_token, refresh_token, expires_at, "
        "user_id, device_id) or a raw OAuth token response. Access: Public."
    ),
    responses=errors(422),
)
async def import_credentials(body: ImportCredentialsRequest, api: ApiDep) -> AccountStatus:
    _apply_import(api, body, "import")
    return account_status(api)


@router.post(
    "/import/file",
    response_model=AccountStatus,
    summary="Import credentials file",
    description="Multipart upload of a credentials.json file. Access: Public.",
    responses=errors(400, 422),
)
async def import_credentials_file(file: UploadFile, api: ApiDep) -> AccountStatus:
    raw = await file.read(1024 * 1024)
    try:
        body = ImportCredentialsRequest.model_validate(json.loads(raw))
    except (ValueError, ValidationError) as error:
        raise AppError(
            "invalid_request", 400, "凭据文件格式不正确，需要包含 access_token 或 refresh_token。"
        ) from error
    _apply_import(api, body, "import-file")
    return account_status(api)


def _apply_import(api: XunleiApi, body: ImportCredentialsRequest, source: str) -> None:
    if body.expires_at:
        expires_at = body.expires_at
    elif body.expires_in:
        expires_at = time.time() + body.expires_in
    else:
        expires_at = 0  # Unknown: force a refresh before first use.
    api.import_credentials(
        access_token=body.access_token,
        refresh_token=body.refresh_token,
        expires_at=expires_at,
        user_id=body.user_id or body.sub,
        device_id=body.device_id or None,
        source=source,
    )
    logger.info("Imported Xunlei credentials (source=%s)", source)


@router.post(
    "/refresh",
    response_model=AccountStatus,
    summary="Refresh access token",
    description="Exchanges the refresh token at `POST /v1/auth/token`. Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def refresh(api: ApiDep) -> AccountStatus:
    await api.refresh_token()
    return account_status(api)


@router.post(
    "/logout",
    response_model=OkResponse,
    summary="Forget stored tokens",
    description="Removes local tokens; the device id is kept. Access: Public.",
)
async def logout(api: ApiDep) -> OkResponse:
    api.logout()
    return OkResponse()


@router.put(
    "/device",
    response_model=AccountStatus,
    summary="Set device id",
    description=(
        "Sets the X-Device-Id. Reuse the id of the device the imported tokens belong to. "
        "Access: Public."
    ),
    responses=errors(422),
)
async def set_device(body: DeviceIdRequest, api: ApiDep) -> AccountStatus:
    api.set_device_id(body.device_id)
    return account_status(api)


@router.post(
    "/qrcode",
    response_model=QrLoginStart,
    summary="Start QR code login",
    description="OAuth2 device code flow (`POST /v1/auth/device/code`). Access: Public.",
    responses=XUNLEI_ERRORS,
)
async def start_qr(api: ApiDep) -> QrLoginStart:
    session_id, session = await api.start_device_login()
    return QrLoginStart(
        session_id=session_id,
        verification_url=session.verification_url,
        user_code=session.user_code,
        expires_in=max(0, int(session.expires_at - time.time())),
        interval=session.interval,
    )


@router.get(
    "/qrcode/{session_id}",
    response_model=QrLoginPoll,
    summary="Poll QR code login",
    description="Polls the device code once; stores tokens on success. Access: Public.",
    responses={**XUNLEI_ERRORS, **errors(404)},
)
async def poll_qr(session_id: str, api: ApiDep) -> QrLoginPoll:
    return QrLoginPoll(status=await api.poll_device_login(session_id))


@router.post(
    "/password",
    response_model=AccountStatus,
    summary="Login with password",
    description=(
        "Captcha init followed by `POST /v1/auth/signin`. Xunlei may require an interactive "
        "captcha, in which case QR login or import is needed. Access: Public."
    ),
    responses=XUNLEI_ERRORS,
)
async def password_login(body: PasswordLoginRequest, api: ApiDep) -> AccountStatus:
    await api.password_login(body.username, body.password)
    return account_status(api)
