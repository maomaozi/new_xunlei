import os
import platform
import shutil
import sys
from pathlib import Path

from fastapi import APIRouter

from app.api.deps import SettingsDep
from app.api.responses import errors
from app.core.config import get_settings
from app.core.errors import AppError
from app.schemas.system import DiskUsage, FsEntry, FsListing, SystemInfo

router = APIRouter(prefix="/system", tags=["system"])

MAX_ENTRIES = 2000


def ensure_allowed(path: Path, roots: list[str]) -> Path:
    resolved = path.resolve()
    for root in roots:
        base = Path(root).expanduser().resolve()
        if resolved == base or resolved.is_relative_to(base):
            return resolved
    raise AppError("path_not_allowed", 403)


def _disk(path: Path) -> DiskUsage | None:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        usage = shutil.disk_usage(probe)
    except OSError:
        return None
    return DiskUsage(path=str(path), total=usage.total, used=usage.used, free=usage.free)


@router.get(
    "/info",
    response_model=SystemInfo,
    summary="Get host information",
    description="Version, data directory and download disk usage. Access: Public.",
)
async def info(store: SettingsDep) -> SystemInfo:
    from app.main import VERSION

    return SystemInfo(
        version=VERSION,
        data_dir=str(get_settings().resolved_data_dir),
        download_disk=_disk(Path(store.current.download.directory).expanduser()),
        python=sys.version.split()[0],
        platform=f"{platform.system()} {platform.machine()}",
    )


@router.get(
    "/fs",
    response_model=FsListing,
    summary="Browse host directories",
    description=(
        "Lists a directory inside `system.browse_roots` for the path pickers. Hidden entries "
        "are skipped. Access: Public."
    ),
    responses=errors(403, 404),
)
async def browse(store: SettingsDep, path: str = "", include_files: bool = True) -> FsListing:
    roots = [str(Path(r).expanduser().resolve()) for r in store.current.system.browse_roots]
    if not roots:
        raise AppError("path_not_allowed", 403)
    target = ensure_allowed(Path(path).expanduser() if path else Path(roots[0]), roots)
    if not target.is_dir():
        raise AppError("path_not_found", 404)
    entries: list[FsEntry] = []
    try:
        with os.scandir(target) as iterator:
            for entry in iterator:
                if entry.name.startswith(".") or len(entries) >= MAX_ENTRIES:
                    continue
                try:
                    is_dir = entry.is_dir()
                    if not is_dir and not include_files:
                        continue
                    stat = entry.stat()
                except OSError:
                    continue
                entries.append(
                    FsEntry(
                        name=entry.name,
                        path=str(Path(entry.path)),
                        kind="dir" if is_dir else "file",
                        size=0 if is_dir else stat.st_size,
                        modified=stat.st_mtime,
                    )
                )
    except PermissionError as error:
        raise AppError("path_not_allowed", 403) from error
    entries.sort(key=lambda e: (e.kind != "dir", e.name.lower()))
    parent: str | None = None
    if str(target) not in roots:
        parent = str(target.parent)
    return FsListing(path=str(target), parent=parent, roots=roots, entries=entries)
