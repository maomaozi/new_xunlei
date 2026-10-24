from typing import Literal

from pydantic import BaseModel, Field, model_validator

EngineState = Literal["disabled", "missing_binary", "stopped", "starting", "running", "crashed"]


class EngineUser(BaseModel):
    id: str = ""
    name: str = ""
    avatar: str = ""
    vip_level: int = 0
    vip_expires_at: str = ""


class EngineDisk(BaseModel):
    path: str
    used: int
    total: int
    is_root: bool


class ForeignEngine(BaseModel):
    pid: int
    command: str
    home: str


class EngineStatus(BaseModel):
    enabled: bool
    state: EngineState
    message: str = Field(description="Human readable reason for the state, if any")
    pid: int | None
    uptime_seconds: int
    restarts: int
    last_exit_code: int | None
    binary_path: str
    binary_version: str
    engine_version: str = Field(description="Version reported by the running engine")
    home_dir: str
    control_port: int
    device_id: str
    space: str = Field(description="Task space served by the engine (device_id#<id>)")
    login_status: str = Field(description="Engine login: '', pending or complete")
    logged_in: bool
    user: EngineUser
    user_mismatch: bool = Field(description="Engine is signed in to another account")
    runner_status: str
    runner_message: str
    running_tasks: int
    disks: list[EngineDisk]
    conflicts: list[ForeignEngine] = Field(
        description="Other xunlei-pan-cli runners on this host; same device id causes kick-outs"
    )


class EngineLoginStatus(BaseModel):
    status: str = Field(description="'' (idle), pending or complete")
    logged_in: bool


class EngineLoginLink(BaseModel):
    url: str


class EngineLogs(BaseModel):
    path: str
    lines: list[str]


class TrialInfo(BaseModel):
    supported: bool
    status: int = Field(description="0 idle, other values mean a trial is active or paused")
    total: int
    used: int
    remaining_seconds: int
    timeout_seconds: int
    average_speed: int
    saved_seconds: int
    stop_reason: str


class EngineFolder(BaseModel):
    id: str
    name: str
    path: str
    writable: bool


class EngineFolderList(BaseModel):
    folders: list[EngineFolder]


DownloadSource = Literal["link", "cloud"]
DownloadFilter = Literal["all", "active", "paused", "complete", "error"]


class SpeedupState(BaseModel):
    p2p: str = ""
    vip: str = ""
    super: str = ""


class DownloadTask(BaseModel):
    id: str
    name: str
    source: DownloadSource
    phase: str
    status: Literal["queued", "running", "paused", "complete", "error"]
    message: str
    error: str
    progress: float = Field(description="Percent; exact while the engine reports live progress")
    size: int
    done_bytes: int
    speed: int
    speedup_speed: int
    speedup: SpeedupState
    url: str
    cloud_file_id: str
    sub_files: str = Field(description="Selected BT sub-file indexes, e.g. 0-2,5")
    local_path: str
    folder_id: str
    hash: str
    icon: str
    created_at: str
    updated_at: str
    params: dict[str, str]


class LiveTask(BaseModel):
    id: str
    name: str
    status: Literal["queued", "running", "paused", "complete", "error"]
    running: bool = Field(description="Currently executed by the download kernel")
    progress: float
    size: int
    done_bytes: int
    speed: int
    speedup_speed: int
    local_path: str


class LiveDownloads(BaseModel):
    """In-memory engine state (`/device/debug`): only tasks the engine is processing."""

    tasks: list[LiveTask]
    running: int
    speed: int


class DownloadSummary(BaseModel):
    total: int
    active: int
    paused: int
    complete: int
    error: int
    speed: int


class DownloadList(BaseModel):
    tasks: list[DownloadTask]
    summary: DownloadSummary
    next_page_token: str


class DownloadCreateRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=200, description="magnet/http/ftp/ed2k")
    files: list[int] | None = Field(
        default=None, max_length=20000, description="BT sub-file indexes; single URL only"
    )
    name: str = Field(default="", max_length=255, description="Task name; single URL only")
    folder_id: str = Field(default="", description="Engine folder id; empty = default folder")

    @model_validator(mode="after")
    def single_url_options(self) -> "DownloadCreateRequest":
        if self.files is not None and len(self.urls) != 1:
            raise ValueError("files can only be used with a single URL")
        if self.files is not None and (not self.files or min(self.files) < 0):
            raise ValueError("files must contain non-negative indexes")
        return self


class CloudDownloadRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=500)
    folder_id: str = Field(default="", description="Engine folder id; empty = default folder")


class DownloadCreateResult(BaseModel):
    source: str = Field(description="The submitted URL or cloud file id")
    ok: bool
    task_id: str = ""
    error: str = ""


class DownloadCreateResponse(BaseModel):
    results: list[DownloadCreateResult]


class DownloadIdsRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


class DownloadDeleteRequest(DownloadIdsRequest):
    delete_files: bool | None = Field(default=None, description="Defaults to settings")
