"""Isolated browser E2E application. Never launches an engine or contacts Xunlei.

Run from backend: uv run uvicorn tests.browser_runner_app:app --port 8019
The real frontend/API/service/client/SQLite run against FakeRunner's HTTP transport.
"""

import asyncio
import socket
import tempfile
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi import FastAPI

from app.core.config import Settings
from app.main import create_app
from app.schemas.engine import EngineStatus
from app.schemas.xunlei import About
from app.services.container import Container
from app.services.engine.client import EngineClient
from app.services.engine.process import EngineProcess
from app.services.engine.tasks import RunnerTasks
from app.services.engine.tokens import SECRET_FILE, SECRET_KEY
from tests.test_runner_tasks import FakeRunner

fixture_dir = tempfile.TemporaryDirectory(prefix="xunlei-browser-e2e-")
app = create_app(
    Settings(
        app_env="test",
        data_dir=Path(fixture_dir.name),
        engine_autostart=False,
        frontend_dist=Path(__file__).resolve().parents[2] / "frontend" / "dist",
    )
)
original_lifespan = app.router.lifespan_context
fake = FakeRunner()
container: Container | None = None


class BrowserProcess(EngineProcess):
    @property
    def alive(self) -> bool:
        return fake.alive


async def fake_user() -> dict[str, Any]:
    return {"sub": "browser-user", "name": "浏览器测试", "vip_info": []}


async def fake_about() -> About:
    return About.model_validate({"quota": {"limit": "10737418240", "usage": "1048576"}})


def fake_engine_status() -> EngineStatus:
    assert container is not None
    return EngineStatus.model_validate(
        {
            "enabled": True,
            "state": "running",
            "message": "",
            "pid": None,
            "uptime_seconds": 100,
            "restarts": 0,
            "last_exit_code": None,
            "binary_path": "fake",
            "binary_version": "3.23.3",
            "engine_version": "3.23.3",
            "home_dir": str(container.engine.home),
            "control_port": container.engine.config.control_port,
            "device_id": container.api.device_id,
            "space": container.api.device_space,
            "login_status": "complete",
            "logged_in": True,
            "user": {"id": "browser-user", "name": "浏览器测试", "vip_level": 6},
            "user_mismatch": False,
            "runner_status": "running",
            "runner_message": "",
            "running_tasks": 1,
            "disks": [],
            "conflicts": [],
        }
    )


async def local_http(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/drive/v1/files":
        return httpx.Response(200, json={"files": []})
    if request.url.path in ("/device/v1/try_speed/get_info", "/device/v1/try_speed/get_config"):
        return httpx.Response(200, json={})
    return await fake.handler(request)


def reset_fake(mode: str = "normal") -> None:
    assert container is not None
    # Each browser scenario gets an independent app inventory as well as native state.
    # Only this harness's temporary SQLite file is touched.
    container.db.execute("DELETE FROM runner_tasks")
    container.engine.tasks.history.clear()
    container.engine.tasks.persisted.clear()
    container.engine.tasks.snapshot = None
    fake.disk.clear()
    fake.memory.clear()
    fake.files.clear()
    fake.cloud.clear()
    fake.requests.clear()
    fake.payloads.clear()
    fake.database_error = mode == "degraded"
    fake.touch_noop = mode == "timeout"
    fake.retain_deleted = False
    fake.fail_delete_sync = mode == "partial_delete"
    fake.touch_delay = 0.7
    fake.add("browser-running")
    fake.add("browser-paused", "PAUSED")
    fake.add("browser-complete", "COMPLETE")
    fake.add("browser-unmapped", mapped=False)
    names = {
        "browser-running": "浏览器测试下载",
        "browser-paused": "暂停的测试下载",
        "browser-complete": "已完成的测试下载",
        "browser-unmapped": "不可控制的测试下载",
    }
    for tid, name in names.items():
        fake.disk[tid]["FileName"] = name
        fake.memory[tid]["name"] = name
    container.engine.tasks.invalidate()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    global container
    async with original_lifespan(application):
        container = application.state.container
        creds = container.api.credentials
        creds.user_id, creds.access_token = "browser-user", "fake-access-token"
        creds.expires_at = time.time() + 86400
        engine = container.engine
        engine.process = BrowserProcess()
        cfg = container.settings.current.model_copy(deep=True)
        cfg.engine.platform = "qnap"
        cfg.engine.stop_with_app = False
        cfg.engine.local_control_fallback = False
        cfg.engine.control_timeout_seconds = 1.5
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cfg.engine.launcher_port = sock.getsockname()[1]
        cfg.engine.download_dir = str(Path(fixture_dir.name) / "downloads")
        container.settings.replace(cfg)
        drive = engine.home / ".drive"
        await asyncio.to_thread(drive.mkdir, parents=True, exist_ok=True)
        secret = b"isolated-browser-secret"
        pad = 16 - len(secret) % 16
        enc = Cipher(algorithms.AES(SECRET_KEY), modes.ECB()).encryptor()
        encrypted = enc.update(secret + bytes([pad]) * pad) + enc.finalize()
        await asyncio.to_thread((drive / SECRET_FILE).write_bytes, encrypted)
        local = EngineClient(cfg.engine.control_port, drive)
        await local._http.aclose()
        local._http = httpx.AsyncClient(
            base_url="http://fake-runner", transport=httpx.MockTransport(local_http)
        )
        engine._client = local
        patches = pytest.MonkeyPatch()
        patches.setattr("app.services.engine.tasks.read_snapshot", fake.read)
        patches.setattr(engine, "_engine_tasks", fake.list_cloud)
        patches.setattr(engine, "status", fake_engine_status)
        patches.setattr(container.api, "get_file", fake.file_info)
        patches.setattr(container.api, "user_me", fake_user)
        patches.setattr(container.api, "about", fake_about)
        # Any unexpected cloud access fails locally instead of reaching a real service.
        await container.api._client.aclose()
        container.api._client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(503, json={"error": "isolated_test"})
            )
        )
        reset_fake()
        try:
            yield
        finally:
            patches.undo()
            container = None
    fixture_dir.cleanup()


app.router.lifespan_context = lifespan


@app.post("/__test__/reset")
async def reset(mode: str = "normal") -> dict[str, str]:
    assert container is not None
    async with container.engine.tasks.lock:
        reset_fake(mode)
    return {"mode": mode}


@app.get("/__test__/evidence")
async def evidence() -> dict[str, Any]:
    return {
        "engine_requests": fake.requests,
        "creation_payloads": fake.payloads,
        "cloud_calls": fake.cloud_calls,
        "data_dir": fixture_dir.name,
    }


@app.post("/__test__/restart")
async def restart_observer() -> dict[str, bool]:
    """Rebuild the production observer to simulate a backend lifetime change."""
    assert container is not None
    previous = container.engine.tasks
    await previous.close()
    async with previous.lock:
        container.engine.tasks = RunnerTasks(container.engine)
    fake.add("browser-after-restart", "PENDING", mapped=False)
    fake.disk["browser-after-restart"]["FileName"] = "重启后出现的任务"
    fake.memory["browser-after-restart"]["name"] = "重启后出现的任务"
    return {"ok": True}


# The application mounts its SPA catch-all before test-only routes are added.
# Keep it last so the diagnostic GET remains reachable in this isolated harness.
app.router.routes.sort(key=lambda route: getattr(route, "path", "") == "/{path:path}")
