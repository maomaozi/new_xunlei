"""Typed forms for native storage templates and separately scoped remote tasks."""

from pydantic import BaseModel, Field

from app.schemas.xunlei import DriveTask


class StorageField(BaseModel):
    title: str
    key: str
    type: str = "text"
    placeholder: str = ""
    max_length: int = 2048
    required: bool = False
    value: str | bool | int = ""


class StorageType(BaseModel):
    name: str
    type: str
    config_templates: list[StorageField] = Field(default_factory=list)


class StorageTypes(BaseModel):
    types: list[StorageType]


class StorageMount(BaseModel):
    id: str
    file_id: str = ""
    type: str
    name: str = ""
    config: dict[str, str] = Field(default_factory=dict)


class StorageList(BaseModel):
    mounts: list[StorageMount]
    next_page_token: str = ""


class StorageCreate(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    config: dict[str, str] = Field(default_factory=dict, max_length=50)


class StorageUpdate(BaseModel):
    config: dict[str, str] = Field(default_factory=dict, max_length=50)


class RemoteTaskCreate(BaseModel):
    url: str = Field(min_length=1, max_length=8192)
    name: str = Field(default="", max_length=255)


class RemoteTaskAction(BaseModel):
    action: str = Field(pattern=r"^(pause|resume|delete)$")


class RemoteTaskResult(BaseModel):
    confirmed: bool
    tasks: list[DriveTask]
