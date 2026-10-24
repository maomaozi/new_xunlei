from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        app_env="test", data_dir=tmp_path / "data", frontend_dist=None, engine_autostart=False
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client
