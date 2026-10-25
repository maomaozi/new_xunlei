"""Platform defaults from the bundled 3.23.3 profile; route probes can narrow them."""

from app.schemas.engine import EngineCapabilities
from app.schemas.settings import EnginePlatform


def platform_capabilities(platform: EnginePlatform) -> EngineCapabilities:
    local = platform in ("qnap", "linux")
    extended = platform == "linux"
    return EngineCapabilities(
        platform=platform,
        launcher=platform in ("qnap", "synology"),
        local_config=local,
        detailed_status=local,
        touch_tasks=local,
        # Mount management is available even on QNAP without its cloud-VFS label.
        storage=True,
        device_spaces=extended,
        remote_devices=extended,
        webhook=extended,
    )
