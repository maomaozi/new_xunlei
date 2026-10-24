from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DEFAULT_CDN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class SettingsSection(BaseModel):
    model_config = ConfigDict(extra="ignore", validate_assignment=True)


class AccountSettings(SettingsSection):
    client_id: str = Field(
        default="X9ibISwpIp8jQ4Ya",
        min_length=1,
        description="OAuth client id decrypted from detect.secret.yaml",
    )
    client_secret: str = Field(default="BlPF2z7HEeutzH4t6zyjLw", min_length=1)
    scope: str = Field(default="pan user profile sso offline pan/xunlei/share/create")
    client_version: str = Field(default="3.23.3", description="Reported client version")
    package_name: str = Field(default="pan.xunlei.cli.synology")
    auto_refresh: bool = Field(default=True, description="Refresh access token before it expires")
    refresh_ahead_seconds: int = Field(default=300, ge=30, le=7200)


class NetworkSettings(SettingsSection):
    auth_host: str = Field(default="https://xluser-ssl.xunlei.com")
    pan_host: str = Field(default="https://api-pan.xunlei.com")
    host_overrides: dict[str, str] = Field(
        default_factory=lambda: {"api-pan.xunlei.com": "101.91.143.206"},
        description="Reverse-engineered custom_host_to_ip pinning (hostname -> IPv4)",
    )
    connect_timeout: float = Field(default=8, ge=1, le=120)
    request_timeout: float = Field(default=15, ge=3, le=300)
    max_retries: int = Field(default=3, ge=0, le=10)
    retry_backoff: float = Field(default=0.8, ge=0, le=30)
    proxy: str = Field(default="", description="Optional HTTP(S)/SOCKS proxy URL")
    verify_tls: bool = True
    api_user_agent: str = Field(default="xunlei-pan-cli/3.23.3")
    cdn_user_agent: str = Field(
        default=DEFAULT_CDN_USER_AGENT,
        description="VIP CDN nodes reset connections from non-browser user agents",
    )

    @field_validator("auth_host", "pan_host")
    @classmethod
    def strip_host(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")):
            raise ValueError("host must start with http:// or https://")
        return value


class DriveSettings(SettingsSection):
    page_size: int = Field(default=100, ge=20, le=500)
    default_view: Literal["list", "grid"] = "list"
    sort_by: Literal["name", "modified_time", "size", "created_time"] = "name"
    sort_order: Literal["asc", "desc"] = "asc"
    folders_first: bool = True
    show_thumbnails: bool = True
    delete_mode: Literal["trash", "permanent"] = "trash"
    confirm_delete: bool = True


class DownloadSettings(SettingsSection):
    directory: str = Field(default=str(Path.home() / "Downloads" / "xunlei"))
    max_concurrent: int = Field(default=2, ge=1, le=10)
    connections_per_file: int = Field(default=4, ge=1, le=16)
    min_segment_mb: int = Field(default=16, ge=1, le=1024)
    chunk_kb: int = Field(default=512, ge=16, le=8192)
    speed_limit_kbps: int = Field(default=0, ge=0, description="0 means unlimited")
    retry_count: int = Field(default=8, ge=0, le=50)
    conflict: Literal["rename", "overwrite", "skip"] = "rename"
    preserve_tree: bool = True
    auto_resume: bool = True
    proxy_browser_downloads: bool = Field(
        default=False,
        description="Stream browser downloads/playback through this server instead of the CDN",
    )
    cloud_engine: Literal["engine", "builtin"] = Field(
        default="engine",
        description="Cloud files go to this host through the Xunlei engine or the HTTP downloader",
    )


class UploadSettings(SettingsSection):
    temp_dir: str = Field(default="", description="Empty means <data dir>/uploads")
    max_concurrent: int = Field(default=2, ge=1, le=8)
    multipart_threshold_mb: int = Field(default=256, ge=5, le=5000)
    part_size_mb: int = Field(default=16, ge=1, le=512)
    part_concurrency: int = Field(default=4, ge=1, le=16)
    instant_only: bool = Field(default=False, description="Fail instead of uploading bytes")
    delete_temp_after: bool = True
    retry_count: int = Field(default=3, ge=0, le=20)


class OfflineSettings(SettingsSection):
    default_parent_id: str = ""
    default_parent_name: str = "根目录"
    refresh_interval_seconds: int = Field(default=5, ge=2, le=120)
    delete_files_with_task: bool = False


class EngineSettings(SettingsSection):
    """The bundled xunlei-pan-cli download engine (xldownloadlib + task runner)."""

    enabled: bool = Field(default=True, description="Run and supervise the engine process")
    binary_path: str = Field(default="", description="Empty uses <project>/engine")
    home_dir: str = Field(default="", description="Engine state directory; empty = <data>/engine")
    platform: Literal["qnap", "synology", "docker"] = Field(
        default="qnap", description="NAS platform identity whose privilege the account holds"
    )
    nas_id: str = Field(default="123456", min_length=1, max_length=64)
    control_port: int = Field(default=5075, ge=1024, le=65533)
    public_port: int = Field(default=21607, ge=1024, le=65535)
    launcher_port: int = Field(default=5071, ge=1024, le=65535)
    download_dir: str = Field(default=str(Path.home() / "Downloads" / "xunlei"))
    extra_download_dirs: list[str] = Field(default_factory=list, max_length=20)
    torrent_dir: str = Field(default="", description="Torrent metadata cache; empty = <home>")
    device_name: str = Field(default="", max_length=60)
    speed_limit_kbps: int = Field(default=0, ge=0, description="0 means unlimited")
    max_running_tasks: int = Field(default=5, ge=1, le=30)
    single_task_max_mb: int = Field(default=100, ge=10, le=4096)
    single_task_reserve_mb: int = Field(default=20, ge=1, le=1024)
    overall_share_max_mb: int = Field(default=200, ge=10, le=8192)
    auto_restart: bool = Field(default=True, description="Restart the engine when it exits")
    stop_with_app: bool = Field(default=True, description="Stop the engine with this server")
    log_max_mb: int = Field(default=20, ge=1, le=1024)
    task_poll_seconds: int = Field(
        default=10, ge=2, le=120, description="Cloud task list refresh while tasks are active"
    )
    live_progress: bool = Field(
        default=True, description="Read progress/speed from the engine's memory every interval"
    )
    live_poll_ms: int = Field(default=1000, ge=500, le=10000)
    delete_files_with_task: bool = False

    @model_validator(mode="after")
    def distinct_ports(self) -> "EngineSettings":
        # control_port + 2 is taken by the engine's pprof server once debug logging is on.
        ports = {self.control_port, self.public_port, self.launcher_port, self.control_port + 2}
        if len(ports) != 4:
            raise ValueError("engine ports must be different")
        return self


class ShareSettings(SettingsSection):
    expiration_days: int = Field(default=7, ge=-1, le=365, description="-1 means permanent")
    use_pass_code: bool = True
    restore_limit: int = Field(default=-1, ge=-1, le=100000, description="-1 means unlimited")
    title: str = "云盘资源分享"


class PlayerSettings(SettingsSection):
    external_player: Literal["none", "potplayer", "vlc", "iina", "infuse", "nplayer", "mpv"] = (
        "none"
    )
    autoplay: bool = True
    remember_volume: bool = True


class UiSettings(SettingsSection):
    theme: Literal["auto", "light", "dark"] = "auto"
    accent: str = Field(default="#5b7cfa", pattern=r"^#[0-9a-fA-F]{6}$")
    density: Literal["comfortable", "compact"] = "comfortable"
    animations: bool = True
    transfer_poll_ms: int = Field(default=1000, ge=300, le=10000)
    show_hidden_tasks: bool = Field(default=False, description="Show internal task types")


class SystemSettings(SettingsSection):
    browse_roots: list[str] = Field(
        default_factory=lambda: [str(Path.home())],
        description="Host directories reachable by the local path picker",
    )


class AppSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account: AccountSettings = Field(default_factory=AccountSettings)
    network: NetworkSettings = Field(default_factory=NetworkSettings)
    drive: DriveSettings = Field(default_factory=DriveSettings)
    download: DownloadSettings = Field(default_factory=DownloadSettings)
    upload: UploadSettings = Field(default_factory=UploadSettings)
    offline: OfflineSettings = Field(default_factory=OfflineSettings)
    engine: EngineSettings = Field(default_factory=EngineSettings)
    share: ShareSettings = Field(default_factory=ShareSettings)
    player: PlayerSettings = Field(default_factory=PlayerSettings)
    ui: UiSettings = Field(default_factory=UiSettings)
    system: SystemSettings = Field(default_factory=SystemSettings)


SectionName = Literal[
    "account",
    "network",
    "drive",
    "download",
    "upload",
    "offline",
    "engine",
    "share",
    "player",
    "ui",
    "system",
]
