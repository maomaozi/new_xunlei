from fastapi import APIRouter

from app.api.deps import SettingsDep
from app.api.responses import errors
from app.schemas.settings import AppSettings, SectionName

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get(
    "",
    response_model=AppSettings,
    summary="Get settings",
    description="All runtime settings, grouped by section. Access: Public.",
)
async def get_all(store: SettingsDep) -> AppSettings:
    return store.current


@router.get(
    "/defaults",
    response_model=AppSettings,
    summary="Get default settings",
    description="Factory defaults for comparison and reset previews. Access: Public.",
)
async def defaults() -> AppSettings:
    return AppSettings()


@router.put(
    "",
    response_model=AppSettings,
    summary="Replace settings",
    description=(
        "Validates and stores all sections. Network changes rebuild the HTTP client; "
        "transfer limits apply to newly scheduled jobs. Access: Public."
    ),
    responses=errors(422),
)
async def replace(body: AppSettings, store: SettingsDep) -> AppSettings:
    return store.replace(body)


@router.post(
    "/{section}/reset",
    response_model=AppSettings,
    summary="Reset one settings section",
    description="Restores factory defaults for a single section. Access: Public.",
    responses=errors(422),
)
async def reset(section: SectionName, store: SettingsDep) -> AppSettings:
    return store.reset_section(section)
