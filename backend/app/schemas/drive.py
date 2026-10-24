from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.xunlei import DriveTask


class Breadcrumb(BaseModel):
    id: str
    name: str


class FileLinkResponse(BaseModel):
    url: str = Field(description="CDN direct link (bound to this server's public IP)")
    proxy_url: str = Field(description="Same-origin streaming URL served by this API")
    expire: str = ""
    name: str
    size: int
    mime_type: str = ""


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str = ""


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class IdsRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


class MoveRequest(IdsRequest):
    parent_id: str = Field(default="", description="Destination folder; empty means root")


class StarRequest(IdsRequest):
    starred: bool = True


class OfflineCreateRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=100, description="magnet/http/ftp/ed2k")
    parent_id: str | None = Field(default=None, description="Defaults to the configured folder")
    name: str = ""
    files: list[int] | None = Field(
        default=None,
        max_length=20000,
        description="BT sub-file indexes to download (`file_index`); only with a single URL",
    )

    @model_validator(mode="after")
    def files_need_single_url(self) -> "OfflineCreateRequest":
        if self.files is not None and len(self.urls) != 1:
            raise ValueError("files can only be used with a single URL")
        if self.files is not None and (not self.files or min(self.files) < 0):
            raise ValueError("files must contain non-negative indexes")
        return self


class OfflineCreateResult(BaseModel):
    url: str
    ok: bool
    task: DriveTask | None = None
    error: str = ""


class OfflineCreateResponse(BaseModel):
    results: list[OfflineCreateResult]


class DeleteTasksRequest(IdsRequest):
    delete_files: bool | None = Field(default=None, description="Defaults to settings")


class TorrentFile(BaseModel):
    index: int = Field(description="BT sub-file index used for selection")
    path: str = Field(description="Path inside the torrent, without its root name")
    size: int


class ResourceRequest(BaseModel):
    url: str = Field(min_length=1, max_length=8192, description="magnet/http/ftp/ed2k link")


class ResourcePreview(BaseModel):
    name: str
    total_size: int
    files: list[TorrentFile]


class TorrentPreview(BaseModel):
    info_hash: str
    name: str
    total_size: int
    magnet: str
    files: list[TorrentFile]


class ShareCreateRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=100)
    expiration_days: int | None = Field(default=None, ge=-1, le=365)
    use_pass_code: bool | None = None
    pass_code: str = Field(default="", pattern=r"^[0-9A-Za-z]{0,8}$")
    restore_limit: int | None = Field(default=None, ge=-1)
    title: str = ""


TaskPhaseFilter = Literal["all", "running", "complete", "error"]
