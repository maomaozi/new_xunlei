import asyncio
import contextlib
import time

from fastapi import APIRouter

from app.api.deps import ApiDep, EngineDep
from app.api.responses import XUNLEI_ERRORS, errors
from app.core.errors import AppError
from app.schemas.account import (
    AccountOverview,
    AccountStatus,
    UserProfile,
    VipInfo,
)
from app.schemas.common import OkResponse
from app.services.xunlei.api import XunleiApi
from app.services.xunlei.http import JsonObject

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
    summary="Get shared engine credential status",
    description=(
        "Credential state; engine sessions are read from the local engine without contacting "
        "Xunlei. Access: Public."
    ),
)
async def get_status(api: ApiDep) -> AccountStatus:
    with contextlib.suppress(AppError):
        await api.sync_engine_credentials()
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
    with contextlib.suppress(AppError):
        await api.sync_engine_credentials()
    status = account_status(api)
    if not status.logged_in:
        return AccountOverview(status=status)
    me, about = await asyncio.gather(api.user_me(), api.about())
    return AccountOverview(status=account_status(api), profile=to_profile(me), quota=about.quota)


@router.post(
    "/refresh",
    response_model=AccountStatus,
    summary="Read the engine's current session",
    description=(
        "Re-reads the local engine's access token; never refreshes OAuth tokens. Access: Public."
    ),
    responses=errors(401, 503),
)
async def refresh(api: ApiDep) -> AccountStatus:
    await api.sync_engine_credentials()
    return account_status(api)


@router.post(
    "/logout",
    response_model=OkResponse,
    summary="Sign out of Xunlei",
    description=(
        "Signs out the engine and clears the backend's in-memory access token. Access: Public."
    ),
    responses=errors(502, 503),
)
async def logout(engine: EngineDep) -> OkResponse:
    await engine.logout()
    return OkResponse()
