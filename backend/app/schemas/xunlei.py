"""Typed views of Xunlei Pan payloads (file.proto / task.proto / share.proto).

Remote payloads are much larger than this; unknown fields are ignored and the
string-encoded int64 values are normalized to integers.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _to_int(value: object) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        return int(float(str(value)))
    except ValueError:
        return 0


def _to_str_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(k): v if isinstance(v, str) else str(v) for k, v in value.items()}


Int = Annotated[int, BeforeValidator(_to_int)]
StrMap = Annotated[dict[str, str], BeforeValidator(_to_str_map)]


class Remote(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class FileLink(Remote):
    url: str = ""
    expire: str = ""
    type: str = ""


class FileAudit(Remote):
    status: str = ""
    message: str = ""


class DriveFile(Remote):
    kind: Literal["drive#file", "drive#folder"] | str = "drive#file"
    id: str
    parent_id: str = ""
    name: str = ""
    size: Int = 0
    file_extension: str = ""
    mime_type: str = ""
    starred: bool = False
    web_content_link: str = ""
    created_time: str = ""
    modified_time: str = ""
    icon_link: str = ""
    thumbnail_link: str = ""
    md5_checksum: str = ""
    hash: str = ""
    links: dict[str, FileLink] = Field(default_factory=dict)
    phase: str = ""
    audit: FileAudit | None = None
    trashed: bool = False
    delete_time: str = ""
    original_url: str = ""
    params: StrMap = Field(default_factory=dict)
    space: str = ""
    writable: bool = True
    folder_type: str = ""
    file_category: str = ""
    source: str = ""
    duration: Int = 0
    resolution: str = ""
    parent_name: str = ""

    @property
    def is_folder(self) -> bool:
        return self.kind == "drive#folder"


class FileList(Remote):
    files: list[DriveFile] = Field(default_factory=list)
    next_page_token: str = ""


class ReferenceResource(Remote):
    kind: str = ""
    id: str = ""
    parent_id: str = ""
    name: str = ""
    size: Int = 0
    mime_type: str = ""
    icon_link: str = ""
    thumbnail_link: str = ""
    phase: str = ""


class DriveTask(Remote):
    kind: str = "drive#task"
    id: str
    name: str = ""
    type: str = ""
    file_id: str = ""
    file_name: str = ""
    file_size: Int = 0
    message: str = ""
    created_time: str = ""
    updated_time: str = ""
    phase: str = ""
    progress: Int = 0
    icon_link: str = ""
    params: StrMap = Field(default_factory=dict)
    space: str = ""
    status_size: Int = 0
    reference_resource: ReferenceResource | None = None


class TaskList(Remote):
    tasks: list[DriveTask] = Field(default_factory=list)
    next_page_token: str = ""


class ResourceNode(Remote):
    """Node of `/drive/v1/resource/list`; BT leaves carry the sub-file `file_index`."""

    id: str = ""
    name: str = ""
    file_size: Int = 0
    file_count: Int = 0
    file_index: Int = 0
    is_dir: bool = False
    dir: "ResourcePage | None" = None
    meta: StrMap = Field(default_factory=dict)


class ResourcePage(Remote):
    resources: list[ResourceNode] = Field(default_factory=list)
    next_page_token: str = ""


class ResourceList(Remote):
    list_id: str = ""
    page: ResourcePage = Field(default_factory=ResourcePage, alias="list")


class Quota(Remote):
    limit: Int = 0
    usage: Int = 0
    usage_in_trash: Int = 0
    is_unlimited: bool = False


class About(Remote):
    quota: Quota = Field(default_factory=Quota)
    expires_at: str = ""


class ShareItem(Remote):
    share_id: str
    share_status: str = ""
    share_status_text: str = ""
    title: str = ""
    icon_link: str = ""
    thumbnail_link: str = ""
    pass_code: str = ""
    file_num: Int = 0
    restore_limit: Int = 0
    restore_count: Int = 0
    expiration_days: Int = 0
    expiration_at: str = ""
    expiration_left: Int = 0
    view_count: Int = 0
    create_time: str = ""
    share_url: str = ""
    file_id: str = ""
    file_kind: str = ""
    file_size: Int = 0
    share_to: str = ""
    params: StrMap = Field(default_factory=dict)


class ShareList(Remote):
    data: list[ShareItem] = Field(default_factory=list)
    next_page_token: str = ""


class ShareCreated(Remote):
    share_id: str = ""
    share_url: str = ""
    pass_code: str = ""
    share_text: str = ""


class DriveEvent(Remote):
    id: str
    type: str = ""
    type_name: str = ""
    device: str = ""
    created_time: str = ""
    updated_time: str = ""
    file_id: str = ""
    file_name: str = ""
    mime_type: str = ""
    icon_url: str = ""
    folder_id: str = ""
    progress: Int = 0
    reference_resource: ReferenceResource | None = None


class EventList(Remote):
    events: list[DriveEvent] = Field(default_factory=list)
    next_page_token: str = ""
