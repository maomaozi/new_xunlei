import asyncio
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.schemas.settings import EnginePlatform
from app.services.container import Container
from app.services.engine.client import EngineClient
from app.services.engine.launcher import LauncherServer
from app.services.engine.process import EngineProcess, LaunchSpec


def container_for(client: TestClient) -> Container:
    return client.app.state.container  # type: ignore[attr-defined,no-any-return]


@pytest.mark.parametrize(
    "platform,needs_launcher",
    [
        ("qnap", True),
        ("synology", True),
        ("docker", False),
        ("linux", False),
    ],
)
def test_platform_launch_uses_only_required_launcher(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    platform: EnginePlatform,
    needs_launcher: bool,
) -> None:
    engine = container_for(client).engine
    binary = tmp_path / "fake-engine"
    binary.touch()
    engine.config.binary_path = str(binary)
    engine.config.platform = platform
    calls: list[str] = []

    async def start_launcher(self: LauncherServer, port: int) -> None:
        calls.append("launcher")

    async def stop_launcher(self: LauncherServer) -> None:
        calls.append("stop-launcher")

    async def start_engine(self: EngineProcess, spec: LaunchSpec) -> None:
        calls.append("engine")
        self.spec = spec

    monkeypatch.setattr(LauncherServer, "start", start_launcher)
    monkeypatch.setattr(LauncherServer, "stop", stop_launcher)
    monkeypatch.setattr(EngineProcess, "start", start_engine)
    asyncio.run(engine._launch())
    asyncio.run(engine.ensure_launcher())
    assert ("launcher" in calls) is needs_launcher
    assert calls.count("engine") == 1
    assert engine._config_supported is (platform in ("qnap", "linux"))


def test_namespaces_isolate_state_and_launch_configuration(
    client: TestClient, tmp_path: Path
) -> None:
    engine = container_for(client).engine
    binary = tmp_path / "fake-engine"
    binary.touch()
    engine.config.binary_path = str(binary)
    engine.config.platform = "linux"
    engine.config.device_space = "device_id#first"
    engine.config.webhook_modules = {"device": ["info", "status"]}
    engine.config.webhook_url = "http://127.0.0.1:12345/rpc"
    first = engine.spec()
    engine.config.device_space = "device_id#second"
    second = engine.spec()
    assert first.home != second.home
    assert first.device_id == "first" and second.device_id == "second"
    assert first.environment()["Webhook"] == "device:info,status http://127.0.0.1:12345/rpc"
    assert second.environment()["DeviceSpace"] == "device_id#second"
    assert engine.api.device_space == "device_id#second"
    assert "LauncherAddress" not in second.environment()
    assert "Webhook" not in replace(second, platform="qnap").environment()


def test_unsupported_runtime_settings_are_not_silently_saved(client: TestClient) -> None:
    value = client.get("/api/v1/settings").json()
    value["engine"]["platform"] = "synology"
    assert client.put("/api/v1/settings", json=value).status_code == 200
    capabilities = client.get("/api/v1/engine/capabilities").json()
    assert not capabilities["local_config"] and capabilities["launcher"]
    value["engine"]["speed_limit_kbps"] = 100
    response = client.put("/api/v1/settings", json=value)
    assert response.status_code == 409
    assert client.get("/api/v1/settings").json()["engine"]["speed_limit_kbps"] == 0
    value["engine"]["platform"] = "linux"
    assert client.put("/api/v1/settings", json=value).status_code == 200


def test_runtime_probe_does_not_disable_another_platform(
    client: TestClient, tmp_path: Path
) -> None:
    engine = container_for(client).engine
    binary = tmp_path / "fake-engine"
    binary.touch()
    engine.config.binary_path = str(binary)
    engine.process.spec = engine.spec()
    engine._config_supported = False
    assert not client.get("/api/v1/engine/capabilities").json()["local_config"]
    assert client.get("/api/v1/engine/capabilities?platform=linux").json()["local_config"]


def test_storage_templates_redaction_and_partial_edit(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = container_for(client).engine
    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: True))
    requests: list[tuple[str, str, object]] = []

    async def fake_call(
        self: EngineClient,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        requests.append((method, path, kwargs.get("json_body")))
        if path.endswith("vfs_types"):
            return {
                "vfs_types": [
                    {
                        "name": "WebDAV",
                        "type": "webdav",
                        "config_templates": [
                            {"title": "主机", "key": "server", "required": True},
                            {
                                "title": "密码",
                                "key": "password",
                                "type": "password",
                                "required": True,
                            },
                        ],
                    }
                ]
            }
        mount = {
            "id": "mount-1",
            "type": "webdav",
            "config": {"server": "test.invalid", "password": "native-private-password"},
        }
        if path.endswith("/vfs") and method == "GET":
            return {"vfs_list": [mount]}
        if method == "GET":
            return mount
        return {}

    async def no_launcher() -> None:
        pass

    monkeypatch.setattr(EngineClient, "call", fake_call)
    monkeypatch.setattr(engine, "ensure_launcher", no_launcher)
    listing = client.get("/api/v1/engine/storage")
    assert listing.status_code == 200
    assert "native-private-password" not in listing.text
    assert "password" not in listing.json()["mounts"][0]["config"]
    response = client.put(
        "/api/v1/engine/storage/mount-1",
        json={"config": {"server": "changed.invalid", "password": ""}},
    )
    assert response.status_code == 200
    posted = next(body for method, path, body in requests if method == "POST")
    assert isinstance(posted, dict)
    assert posted["config"] == {"server": "changed.invalid", "password": "native-private-password"}
    requests.clear()
    invalid = client.post("/api/v1/engine/storage", json={"type": "unadvertised", "config": {}})
    assert invalid.status_code == 422
    assert not any(method == "POST" for method, _, _ in requests)


@pytest.mark.parametrize("observed", [True, False])
def test_remote_control_cannot_touch_local_or_unconfigured_tasks(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    observed: bool,
) -> None:
    settings = client.get("/api/v1/settings").json()
    settings["engine"].update(
        platform="linux", remote_devices=[{"device_id": "remote-1", "name": "NAS"}]
    )
    assert client.put("/api/v1/settings", json=settings).status_code == 200
    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: True))
    phase = "PHASE_TYPE_RUNNING"
    writes: list[dict[str, Any]] = []

    async def fake_call(
        self: EngineClient,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        nonlocal phase
        if method == "GET":
            assert kwargs["params"]["space"] == "device_id#remote-1"
            return {
                "tasks": [
                    {
                        "id": "remote-task",
                        "type": "user#download-url",
                        "space": "device_id#remote-1",
                        "phase": phase,
                    },
                    {"id": "local-task", "space": "device_id#local"},
                ]
            }
        body = kwargs["json_body"]
        writes.append(body)
        assert body["space"] == "device_id#remote-1"
        assert body["id"] == "remote-task"
        assert json.loads(body["set_params"]["spec"])["phase"] == "pause"
        if observed:
            phase = "PHASE_TYPE_PAUSED"
        return {}

    monkeypatch.setattr(EngineClient, "call", fake_call)
    assert client.get("/api/v1/engine/devices/unconfigured/tasks").status_code == 404
    listing = client.get("/api/v1/engine/devices/remote-1/tasks").json()
    assert [task["id"] for task in listing["tasks"]] == ["remote-task"]
    path = "/api/v1/engine/devices/remote-1/tasks/"
    assert client.post(path + "local-task", json={"action": "pause"}).status_code == 404
    assert not writes
    controlled = client.post(path + "remote-task", json={"action": "pause"})
    assert controlled.status_code == 200 and controlled.json()["confirmed"] is observed
    assert len(writes) == 1


def test_storage_edit_stops_when_account_changes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = container_for(client).engine
    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: True))
    posts: list[str] = []

    async def call(self: EngineClient, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if method == "POST":
            posts.append(path)
        if path.endswith("vfs_types"):
            engine.api._auth_epoch += 1
            return {"vfs_types": []}
        return {"id": "old-mount", "type": "webdav", "config": {"password": "old-secret"}}

    async def no_launcher() -> None:
        pass

    monkeypatch.setattr(engine, "ensure_launcher", no_launcher)
    monkeypatch.setattr(EngineClient, "call", call)
    result = client.put("/api/v1/engine/storage/old-mount", json={"config": {"password": ""}})
    assert result.status_code == 409
    assert not posts
