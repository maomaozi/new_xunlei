from fastapi import APIRouter

from app.api.v1.account import router as account_router
from app.api.v1.downloads import router as downloads_router
from app.api.v1.engine import router as engine_router
from app.api.v1.engine_extensions import router as engine_extensions_router
from app.api.v1.files import router as files_router
from app.api.v1.health import router as health_router
from app.api.v1.offline import router as offline_router
from app.api.v1.settings import router as settings_router
from app.api.v1.shares import events_router
from app.api.v1.shares import router as shares_router
from app.api.v1.system import router as system_router
from app.api.v1.transfers import router as transfers_router
from app.api.v1.trash import router as trash_router

api_router = APIRouter(prefix="/api/v1")
for router in (
    health_router,
    account_router,
    files_router,
    trash_router,
    offline_router,
    engine_router,
    engine_extensions_router,
    downloads_router,
    shares_router,
    events_router,
    transfers_router,
    settings_router,
    system_router,
):
    api_router.include_router(router)

OPENAPI_TAGS = [
    {"name": "health", "description": "Public process health checks."},
    {"name": "account", "description": "Xunlei login (QR / password / import) and profile."},
    {"name": "files", "description": "Cloud drive browsing and file operations."},
    {"name": "trash", "description": "Cloud drive trash."},
    {"name": "offline", "description": "Cloud add (离线下载) tasks."},
    {"name": "engine", "description": "Bundled Xunlei download engine: process, login, config."},
    {"name": "downloads", "description": "Downloads executed by the engine on this host."},
    {"name": "shares", "description": "Share links."},
    {"name": "events", "description": "Drive activity feed."},
    {"name": "transfers", "description": "Downloads/uploads between this host and the cloud."},
    {"name": "settings", "description": "Runtime settings editable from the web UI."},
    {"name": "system", "description": "Host information and local path picker."},
]
