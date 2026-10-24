from typing import Literal

from pydantic import BaseModel, Field

from app.repositories.transfers import TransferKind, TransferStatus


class TransferItem(BaseModel):
    id: str
    kind: TransferKind
    status: TransferStatus
    name: str
    file_id: str
    parent_id: str
    local_path: str
    size: int
    done_bytes: int
    speed: float = Field(description="Bytes per second over the last few seconds")
    phase: str = Field(description="resolving/downloading/hashing/creating/uploading/instant/...")
    error: str
    group_id: str
    group_name: str
    instant: bool = Field(description="Completed via GCID instant upload")
    connections: int
    created_at: str
    updated_at: str
    finished_at: str


class TransferSummary(BaseModel):
    active: int
    queued: int
    running: int
    paused: int
    failed: int
    completed: int
    download_speed: float
    upload_speed: float


class TransferList(BaseModel):
    items: list[TransferItem]
    summary: TransferSummary


class DownloadRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=500)
    directory: str | None = Field(default=None, description="Defaults to download.directory")


class LocalUploadRequest(BaseModel):
    path: str = Field(min_length=1, description="File or directory on this host")
    parent_id: str = ""


class TransferDeleteRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    delete_files: bool = False


class EnqueueResponse(BaseModel):
    count: int


TransferAction = Literal["pause", "resume", "cancel"]
