from typing import Literal

from pydantic import BaseModel


class DiskUsage(BaseModel):
    path: str
    total: int
    used: int
    free: int


class SystemInfo(BaseModel):
    version: str
    data_dir: str
    download_disk: DiskUsage | None
    python: str
    platform: str


class FsEntry(BaseModel):
    name: str
    path: str
    kind: Literal["dir", "file"]
    size: int
    modified: float


class FsListing(BaseModel):
    path: str
    parent: str | None
    roots: list[str]
    entries: list[FsEntry]
