from fastapi import APIRouter

from app.api.deps import EngineDep, SettingsDep
from app.api.responses import errors
from app.core.errors import AppError
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
async def replace(body: AppSettings, store: SettingsDep, engine: EngineDep) -> AppSettings:
    before = store.current.engine
    after = body.engine
    capabilities = engine.capabilities(after.platform)
    runtime_fields = (
        "speed_limit_kbps",
        "max_running_tasks",
        "device_name",
        "extra_download_dirs",
        "single_task_max_mb",
        "single_task_reserve_mb",
        "overall_share_max_mb",
    )
    if not capabilities.local_config and any(
        getattr(before, field) != getattr(after, field) for field in runtime_fields
    ):
        raise AppError("invalid_request", 409, "请先选择支持运行配置的平台。")
    for enabled, fields in (
        (capabilities.device_spaces, ("device_space",)),
        (capabilities.remote_devices, ("remote_devices",)),
        (capabilities.webhook, ("webhook_url", "webhook_modules")),
    ):
        if not enabled and any(getattr(before, field) != getattr(after, field) for field in fields):
            raise AppError("invalid_request", 409, "请先切换平台。")
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
