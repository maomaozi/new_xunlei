import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Process-level settings loaded from `.env.<APP_ENV>`.

    Everything a user may want to tune at runtime lives in the database-backed
    `AppSettings` instead (see `app.schemas.settings`).
    """

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "Xunlei Downloader API"
    app_debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = Field(default_factory=list)
    data_dir: Path = Path("data")
    frontend_dist: Path | None = Path("../frontend/dist")
    # Lets tests and tooling create the app without spawning the download engine.
    engine_autostart: bool = True

    @property
    def resolved_data_dir(self) -> Path:
        path = self.data_dir if self.data_dir.is_absolute() else BACKEND_DIR / self.data_dir
        return path.resolve()

    @property
    def database_path(self) -> Path:
        return self.resolved_data_dir / "xunlei_web.sqlite3"

    @property
    def resolved_frontend_dist(self) -> Path | None:
        if self.frontend_dist is None:
            return None
        path = self.frontend_dist
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path.resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    environment = os.getenv("APP_ENV", "development")
    return Settings(_env_file=BACKEND_DIR / f".env.{environment}")
