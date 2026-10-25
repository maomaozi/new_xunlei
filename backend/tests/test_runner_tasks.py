"""Isolated API E2E with the actual EngineClient, RunnerTasks and SQLite history.

No Xunlei endpoint is contacted. Both engine and cloud transports are deterministic fakes.
"""

import asyncio
import copy
import json
import socket
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.errors import AppError
from app.schemas.xunlei import DriveFile, DriveTask
from app.services.container import Container
from app.services.engine.client import EngineClient
from app.services.engine.local_db import LocalDatabaseError, LocalIdentity, LocalSnapshot
from app.services.engine.process import EngineProcess
from app.services.engine.tokens import SECRET_FILE, SECRET_KEY


@dataclass
class FakeRunner:
    disk: dict[str, dict[str, Any]] = field(default_factory=dict)
    memory: dict[str, dict[str, Any]] = field(default_factory=dict)
    files: list[dict[str, Any]] = field(default_factory=list)
    cloud: list[DriveTask] = field(default_factory=list)
    requests: list[tuple[str, str]] = field(default_factory=list)
    payloads: list[dict[str, Any]] = field(default_factory=list)
    deleted_batches: list[list[str]] = field(default_factory=list)
    alive: bool = True
    database_error: bool = False
    cloud_error: bool = True
    cloud_delay: float = 0
    cloud_calls: int = 0
    touch_noop: bool = False
    touch_delay: float = 0
    lose_create_response: bool = False
    retain_deleted: bool = False
    retain_local_history: bool = False
    running_only: set[str] = field(default_factory=set)
    fail_delete_sync: bool = False
    txid: int = 1

    def add(self, tid: str, phase: str = "RUNNING", *, mapped: bool = True) -> None:
        phase = "PHASE_TYPE_" + phase
        self.disk[tid] = {
            "ID": len(self.disk) + 1,
            "TaskId": tid,
            "TaskType": "user#download-url",
            "DLTaskId": "kernel-" + tid if mapped else "",
            "Phase": phase,
            "FileName": tid,
            "Url": "https://example.invalid/" + tid,
            "Info": {"FileSize": 1000, "DownloadSize": 250},
        }
        self.memory[tid] = {
            "id": tid,
            "name": tid,
            "type": "user#download-url",
            "phase": phase,
            "progress": 25.0,
            "file_size": "1000",
            "params": {
                "url": "https://example.invalid/" + tid,
                "speed": "100",
                "speedup": '{"p2p":"started","vip":"started"}',
            },
        }

    def transition(self, tid: str, phase: str) -> None:
        self.disk[tid]["Phase"] = phase
        self.memory[tid]["phase"] = phase
        self.txid += 1

    def read(self, identity: LocalIdentity) -> LocalSnapshot:
        if self.database_error:
            raise LocalDatabaseError("corrupt test snapshot")
        return LocalSnapshot(
            copy.deepcopy(list(self.disk.values())), copy.deepcopy(self.files), self.txid
        )

    async def list_cloud(self, phases: str) -> list[DriveTask]:
        self.cloud_calls += 1
        await asyncio.sleep(self.cloud_delay)
        if self.cloud_error:
            raise AppError("xunlei_unreachable", 503)
        return self.cloud

    async def file_info(self, file_id: str) -> DriveFile:
        if file_id == "refused":
            raise AppError("xunlei_error", 403, "此文件无法下载。")
        return DriveFile.model_validate({"id": file_id, "name": "cloud-name"})

    async def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((request.method, path))
        if path == "/device/debug":
            assert request.headers["LocalToken"].startswith("LocalToken ")
            return httpx.Response(
                200,
                json={
                    "Process": list(self.memory.values()),
                    "Running": {
                        **dict.fromkeys(self.running_only, True),
                        **{
                            tid: True
                            for tid, item in self.memory.items()
                            if item["phase"] == "PHASE_TYPE_RUNNING"
                        },
                    },
                },
            )
        if path == "/device/v1/touch_dltask":
            assert request.headers["LocalToken"].startswith("LocalToken ")
            await asyncio.sleep(self.touch_delay)
            kernel = request.url.params["dltask_id"]
            tid = next(
                (tid for tid, item in self.disk.items() if item.get("DLTaskId") == kernel), ""
            )
            if not tid or self.touch_noop:
                return httpx.Response(200, json={})
            event = request.url.params["event"]
            if event == "delete":
                if not self.retain_deleted:
                    if not self.retain_local_history:
                        self.disk.pop(tid, None)
                    self.memory.pop(tid, None)
            else:
                self.transition(
                    tid, "PHASE_TYPE_PAUSED" if event == "stop" else "PHASE_TYPE_PENDING"
                )
            return httpx.Response(200, json={})
        assert request.headers["pan-auth"]
        if path == "/drive/v1/task" and request.method == "POST":
            body = json.loads(request.content)
            self.payloads.append(body)
            tid = "created-" + str(len(self.payloads))
            self.add(tid, "PENDING", mapped=False)
            self.memory[tid].update(body)
            self.memory[tid]["id"] = tid
            self.disk[tid].update(
                {
                    "Url": body["params"].get("url", ""),
                    "FileName": body["name"],
                    "TaskType": body["type"],
                    "FileId": body["params"].get("file_id", ""),
                }
            )
            if self.lose_create_response:
                raise httpx.ReadError("response lost", request=request)
            return httpx.Response(200, json={"task": self.memory[tid]})
        if path == "/drive/v1/task" and request.method == "PATCH":
            if self.cloud_error:
                return httpx.Response(503, json={"error": "upstream_unavailable"})
            body = json.loads(request.content)
            phase = json.loads(body["set_params"]["spec"])["phase"]
            if body["id"] in self.disk:
                self.transition(
                    body["id"], "PHASE_TYPE_PAUSED" if phase == "pause" else "PHASE_TYPE_PENDING"
                )
            return httpx.Response(200, json={"HttpStatus": 0})
        if path == "/drive/v1/tasks" and request.method == "DELETE":
            if self.fail_delete_sync:
                return httpx.Response(503, json={"error": "upstream_unavailable"})
            ids = request.url.params.get_list("task_ids")
            self.deleted_batches.append(ids)
            for tid in ids:
                if not self.retain_deleted:
                    if not self.retain_local_history:
                        self.disk.pop(tid, None)
                    self.memory.pop(tid, None)
            self.cloud = [item for item in self.cloud if item.id not in ids]
            return httpx.Response(200, json={})
        raise AssertionError((request.method, path))


@pytest.fixture
def runner(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[tuple[FakeRunner, Container]]:
    container: Container = client.app.state.container  # type: ignore[attr-defined]
    engine = container.engine
    container.api.credentials.user_id = "test-user"
    fake = FakeRunner()
    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: fake.alive))
    monkeypatch.setattr("app.services.engine.tasks.read_snapshot", fake.read)
    monkeypatch.setattr(engine, "_engine_tasks", fake.list_cloud)
    monkeypatch.setattr(container.api, "get_file", fake.file_info)
    # Use the real local JWT reader/client, with a temporary encrypted token secret.
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    drive = engine.home / ".drive"
    drive.mkdir(parents=True)
    secret = b"fake-runner-secret"
    pad = 16 - len(secret) % 16
    enc = Cipher(algorithms.AES(SECRET_KEY), modes.ECB()).encryptor()
    (drive / SECRET_FILE).write_bytes(enc.update(secret + bytes([pad]) * pad) + enc.finalize())
    local = EngineClient(engine.config.control_port, drive)
    # The initial client has not made requests; replacement is closed with the app lifespan.
    client.portal.call(local._http.aclose)  # type: ignore[union-attr]
    local._http = httpx.AsyncClient(
        base_url="http://fake-runner", transport=httpx.MockTransport(fake.handler)
    )
    engine._client = local
    settings = container.settings.current.model_copy(deep=True)
    settings.engine.platform = "qnap"
    settings.engine.control_timeout_seconds = 1
    settings.engine.local_control_fallback = False
    settings.engine.download_dir = str(tmp_path / "downloads")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        settings.engine.launcher_port = sock.getsockname()[1]
    container.settings.replace(settings)
    yield fake, container


def test_local_api_end_to_end_without_cloud(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("mine")
    listed = client.get("/api/v1/downloads").json()
    assert listed["summary"]["active"] == 1
    assert listed["tasks"][0]["speed"] == 100
    assert listed["tasks"][0]["speedup"]["vip"] == "started"
    detail = client.get("/api/v1/downloads/mine").json()
    live = client.get("/api/v1/downloads/live").json()
    assert detail["version"] == live["version"] == listed["version"]
    paused = client.post("/api/v1/downloads/pause", json={"ids": ["mine"]}).json()
    assert paused["ok"] and paused["results"][0]["transport"] == "touch"
    assert client.get("/api/v1/downloads?status=active").json()["tasks"] == []
    assert client.get("/api/v1/downloads?status=paused").json()["summary"]["paused"] == 1
    resumed = client.post("/api/v1/downloads/resume", json={"ids": ["mine"]}).json()
    assert resumed["ok"] and resumed["results"][0]["task"]["status"] == "queued"
    assert client.get("/api/v1/downloads/mine").json()["speed"] == 0
    deleted = client.post(
        "/api/v1/downloads/delete", json={"ids": ["mine"], "delete_files": False}
    ).json()
    assert deleted["ok"] and deleted["results"][0]["locally_removed"]
    assert client.get("/api/v1/downloads").json()["tasks"] == []
    assert client.get("/api/v1/downloads/mine").status_code == 404
    assert fake.payloads == []
    assert container.engine.tasks.history["mine"].deleted


def test_missing_mapping_unknown_receipt_and_batch_partial(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, _ = runner
    fake.add("valid")
    fake.add("unmapped", mapped=False)
    response = client.post(
        "/api/v1/downloads/pause", json={"ids": ["valid", "unmapped", "missing"]}
    ).json()
    assert not response["ok"]
    assert [item["status"] for item in response["results"]] == [
        "confirmed",
        "unsupported",
        "not_found",
    ]
    touches = [item for item in fake.requests if item[1] == "/device/v1/touch_dltask"]
    assert len(touches) == 1
    fake.touch_noop = True
    response = client.post("/api/v1/downloads/resume", json={"ids": ["valid"]}).json()
    assert response["results"][0]["status"] == "timeout"
    assert client.get("/api/v1/downloads/valid").json()["status"] == "paused"


def test_control_timeout_includes_http(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, _ = runner
    fake.add("slow")
    fake.touch_delay = 3
    started = time.monotonic()
    response = client.post("/api/v1/downloads/pause", json={"ids": ["slow"]}).json()
    assert 0.8 < time.monotonic() - started < 1.7
    assert response["results"][0]["status"] == "timeout"


def test_proxy_preserves_unmapped_queued_control(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("queued", "PENDING", mapped=False)
    fake.cloud_error = False
    container.settings.current.engine.local_control_fallback = True
    paused = client.post("/api/v1/downloads/pause", json={"ids": ["queued"]}).json()
    assert paused["ok"] and paused["results"][0]["transport"] == "runner_proxy"
    resumed = client.post("/api/v1/downloads/resume", json={"ids": ["queued"]}).json()
    assert resumed["ok"] and resumed["results"][0]["task"]["status"] == "queued"
    assert not any(path == "/device/v1/touch_dltask" for _, path in fake.requests)


def test_cloud_latency_and_stale_cloud_never_override_local(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("fresh", "PAUSED")
    fake.cloud_error = False
    fake.cloud_delay = 10
    fake.cloud = [
        DriveTask.model_validate(
            {"id": "fresh", "phase": "PHASE_TYPE_RUNNING", "type": "user#download-url"}
        )
    ]
    start = time.monotonic()
    assert client.get("/api/v1/downloads?status=paused").json()["summary"]["paused"] == 1
    assert time.monotonic() - start < 0.5
    assert client.get("/api/v1/downloads/fresh").json()["status"] == "paused"
    assert fake.cloud_calls == 1
    container.engine.tasks.cloud = fake.cloud
    container.engine.tasks.invalidate()
    assert client.get("/api/v1/downloads?status=active").json()["tasks"] == []


def test_confirmed_transition_survives_stale_disk_and_missing_memory(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("lag")
    # Real engines can expose new memory state before their persisted phase is flushed.
    original = fake.transition

    def memory_only(tid: str, phase: str) -> None:
        original(tid, phase)
        fake.disk[tid]["Phase"] = "PHASE_TYPE_RUNNING"

    fake.transition = memory_only  # type: ignore[method-assign]
    assert client.post("/api/v1/downloads/pause", json={"ids": ["lag"]}).json()["ok"]
    fake.memory.clear()
    container.engine.tasks.invalidate()
    result = client.get("/api/v1/downloads/lag").json()
    assert result["status"] == "paused"
    assert result["phase"] == "PHASE_TYPE_PAUSED"


def test_stopped_history_parse_failure_and_instance_switch(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("old-account")
    assert client.get("/api/v1/downloads").json()["summary"]["total"] == 1
    fake.alive = False
    fake.database_error = True
    container.engine.tasks.invalidate()
    saved = client.get("/api/v1/downloads").json()
    assert saved["stale"] and saved["tasks"][0]["stale"]
    assert not any(saved["tasks"][0]["capabilities"].values())
    container.api.credentials.user_id = "another-account"
    response = client.get("/api/v1/downloads")
    assert response.status_code == 503
    assert container.engine.tasks.history == {}


def test_proxy_delete_retaining_memory_never_cleans_files(
    client: TestClient, runner: tuple[FakeRunner, Container], tmp_path: Path
) -> None:
    fake, container = runner
    fake.add("retained", mapped=False)
    fake.retain_deleted = True
    container.settings.current.engine.local_control_fallback = True
    root = Path(container.settings.current.engine.download_dir)
    root.mkdir()
    path = root / "mine"
    path.write_text("still writable")
    fake.disk["retained"]["FullPath"] = str(path)
    response = client.post(
        "/api/v1/downloads/delete", json={"ids": ["retained"], "delete_files": True}
    ).json()
    assert not response["ok"] and response["results"][0]["status"] == "timeout"
    assert path.exists() and not container.engine.tasks.history["retained"].deleted


def test_native_batch_delete_uses_repeated_query_parameters(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("first")
    fake.add("second")
    client.portal.call(  # type: ignore[union-attr]
        container.engine.require_running().delete_tasks,
        ["first", "second"],
        container.api.device_space,
    )
    assert fake.deleted_batches == [["first", "second"]]
    assert fake.disk == fake.memory == {}


@pytest.mark.parametrize("delete_files", [False, True])
def test_delete_settles_after_timeout_and_history_reload(
    client: TestClient,
    runner: tuple[FakeRunner, Container],
    delete_files: bool,
) -> None:
    fake, container = runner
    fake.add("late-delete", mapped=False)
    fake.retain_deleted = True
    container.settings.current.engine.local_control_fallback = True
    root = Path(container.settings.current.engine.download_dir)
    root.mkdir()
    path = root / "keep.bin"
    path.write_bytes(b"downloaded")
    fake.disk["late-delete"]["FullPath"] = str(path)
    response = client.post(
        "/api/v1/downloads/delete", json={"ids": ["late-delete"], "delete_files": delete_files}
    ).json()
    assert response["results"][0]["status"] == "timeout"
    fake.disk.clear()
    fake.memory.clear()
    # Load persisted state just as a backend restart would, including cleanup intent.
    container.engine.tasks.identity = None
    listed = client.get("/api/v1/downloads").json()
    saved = container.engine.tasks.history["late-delete"]
    assert saved.operation is not None and saved.operation.locally_removed
    assert path.read_bytes() == b"downloaded"
    if delete_files:
        assert listed["summary"]["total"] == 1
        assert saved.operation.status == "partial"
        fake.retain_deleted = False
        retried = client.post(
            "/api/v1/downloads/delete", json={"ids": ["late-delete"], "delete_files": True}
        ).json()
        assert retried["ok"] and not path.exists()
    else:
        assert listed["tasks"] == [] and listed["summary"]["total"] == 0
        assert saved.deleted and saved.operation.status == "confirmed"
        assert client.get("/api/v1/downloads/late-delete").status_code == 404
        assert client.get("/api/v1/downloads/live").json()["downloads"] == []
        container.engine.tasks.identity = None
        assert client.get("/api/v1/downloads").json()["tasks"] == []


@pytest.mark.parametrize("unavailable", ["database", "live"])
def test_late_delete_needs_both_local_sources(
    client: TestClient, runner: tuple[FakeRunner, Container], unavailable: str
) -> None:
    fake, container = runner
    fake.add("unknown-delete", mapped=False)
    fake.retain_deleted = True
    container.settings.current.engine.local_control_fallback = True
    client.post("/api/v1/downloads/delete", json={"ids": ["unknown-delete"], "delete_files": False})
    fake.disk.clear()
    fake.memory.clear()
    if unavailable == "database":
        fake.database_error = True
    else:
        fake.alive = False
    container.engine.tasks.invalidate()
    listed = client.get("/api/v1/downloads").json()
    assert len(listed["tasks"]) == 1
    saved = container.engine.tasks.history["unknown-delete"]
    assert not saved.deleted and saved.operation is not None
    assert not saved.operation.locally_removed


def test_cloud_only_delete_confirms_empty_local_inventory(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.cloud_error = False
    fake.cloud = [
        DriveTask.model_validate(
            {"id": "cloud-history", "type": "user#download-url", "phase": "PHASE_TYPE_COMPLETE"}
        )
    ]
    container.settings.current.engine.local_control_fallback = True
    client.get("/api/v1/downloads")
    client.portal.call(asyncio.sleep, 0.05)  # type: ignore[union-attr]
    response = client.post(
        "/api/v1/downloads/delete", json={"ids": ["cloud-history"], "delete_files": False}
    ).json()
    assert response["ok"] and response["results"][0]["locally_removed"]
    assert client.get("/api/v1/downloads").json()["tasks"] == []


def test_old_cloud_enrichment_cannot_resurrect_confirmed_delete(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("deleted")
    assert client.post(
        "/api/v1/downloads/delete", json={"ids": ["deleted"], "delete_files": False}
    ).json()["ok"]
    fake.cloud_error = False
    fake.cloud = [
        DriveTask.model_validate(
            {"id": "deleted", "type": "user#download-url", "phase": "PHASE_TYPE_RUNNING"}
        )
    ]
    identity = container.engine.tasks.identity
    assert identity is not None
    client.portal.call(container.engine.tasks._enrich, identity)  # type: ignore[union-attr]
    assert client.get("/api/v1/downloads").json()["tasks"] == []
    # Actual local reappearance still exposes the task for another deletion.
    fake.add("deleted")
    container.engine.tasks.invalidate()
    listed = client.get("/api/v1/downloads").json()
    assert listed["tasks"][0]["operation"]["status"] == "partial"
    assert not container.engine.tasks.history["deleted"].deleted


@pytest.mark.parametrize("delete_files", [False, True])
def test_unmapped_native_history_is_retired_without_resurrection(
    client: TestClient, runner: tuple[FakeRunner, Container], delete_files: bool
) -> None:
    fake, container = runner
    fake.add("native-history", mapped=False)
    fake.retain_local_history = True
    container.settings.current.engine.local_control_fallback = True
    root = Path(container.settings.current.engine.download_dir)
    root.mkdir()
    path = root / "history.bin"
    path.write_bytes(b"preserve unless requested")
    fake.disk["native-history"]["FullPath"] = str(path)
    result = client.post(
        "/api/v1/downloads/delete",
        json={"ids": ["native-history"], "delete_files": delete_files},
    ).json()
    assert result["ok"] and result["results"][0]["local_history_retained"]
    assert not result["results"][0]["locally_removed"]
    assert "native-history" in fake.disk
    assert path.exists() is not delete_files
    saved = container.engine.tasks.history["native-history"]
    assert saved.deleted and saved.retired_record
    container.engine.tasks.identity = None
    assert client.get("/api/v1/downloads").json()["tasks"] == []
    assert client.get("/api/v1/downloads/live").json()["downloads"] == []
    assert client.get("/api/v1/downloads/native-history").status_code == 404
    repeated = client.post(
        "/api/v1/downloads/delete", json={"ids": ["native-history"], "delete_files": False}
    ).json()
    assert repeated["ok"] and repeated["results"][0]["local_history_retained"]
    assert len([r for r in fake.requests if r == ("DELETE", "/drive/v1/tasks")]) == 1
    # A changed native record cannot be hidden by an old tombstone.
    fake.disk["native-history"]["DLTaskId"] = "new-kernel-id"
    container.engine.tasks.invalidate()
    reappeared = client.get("/api/v1/downloads").json()["tasks"]
    assert len(reappeared) == 1 and reappeared[0]["operation"]["status"] == "partial"


def test_mapped_native_history_is_not_treated_as_passive(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("still-mapped")
    fake.retain_local_history = True
    container.settings.current.engine.local_control_fallback = True
    result = client.post(
        "/api/v1/downloads/delete", json={"ids": ["still-mapped"], "delete_files": False}
    ).json()
    assert not result["ok"] and result["results"][0]["status"] == "timeout"
    assert not container.engine.tasks.history["still-mapped"].deleted


def test_running_marker_blocks_retirement_and_file_cleanup(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("running-only", mapped=False)
    fake.retain_local_history = True
    fake.running_only.add("running-only")
    container.settings.current.engine.local_control_fallback = True
    root = Path(container.settings.current.engine.download_dir)
    root.mkdir()
    path = root / "active.bin"
    path.write_bytes(b"active")
    fake.disk["running-only"]["FullPath"] = str(path)
    result = client.post(
        "/api/v1/downloads/delete", json={"ids": ["running-only"], "delete_files": True}
    ).json()
    assert not result["ok"] and result["results"][0]["status"] == "timeout"
    assert path.exists() and not container.engine.tasks.history["running-only"].deleted


def test_safe_multifile_cleanup_and_retry_partial(
    client: TestClient, runner: tuple[FakeRunner, Container], tmp_path: Path
) -> None:
    fake, container = runner
    fake.add("bt", "COMPLETE")
    root = Path(container.settings.current.engine.download_dir)
    folder = root / "bt"
    folder.mkdir(parents=True)
    mine = folder / "mine.bin"
    other = folder / "unrelated.bin"
    mine.write_bytes(b"mine")
    other.write_bytes(b"keep")
    fake.disk["bt"]["FullPath"] = str(folder)
    fake.files = [{"TaskId": "bt", "RealPath": str(mine)}]
    response = client.post(
        "/api/v1/downloads/delete", json={"ids": ["bt"], "delete_files": True}
    ).json()
    result = response["results"][0]
    assert result["status"] == "partial" and result["cleanup_errors"]
    assert not mine.exists() and other.read_bytes() == b"keep"
    assert not container.engine.tasks.history["bt"].deleted
    other.unlink()
    retried = client.post(
        "/api/v1/downloads/delete", json={"ids": ["bt"], "delete_files": True}
    ).json()
    assert retried["ok"] and not folder.exists()


def test_creation_metadata_cloud_permissions_and_lost_response(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    body = {
        "urls": ["magnet:?xt=urn:btih:abc&dn=test"],
        "name": "BT test",
        "files": [0, 1, 3],
        "folder_id": "folder-7",
    }
    response = client.post("/api/v1/downloads", json=body).json()
    assert response["results"][0]["ok"]
    payload = fake.payloads[0]
    assert payload["params"]["parent_folder_id"] == "folder-7"
    assert payload["params"]["sub_file_index"] == "0-1,3"
    assert payload["space"] == payload["params"]["target"] == container.api.device_space
    task = client.get("/api/v1/downloads/created-1").json()
    assert task["folder_id"] == "folder-7" and task["sub_files"] == "0-1,3"
    assert (
        client.post(
            "/api/v1/downloads/cloud", json={"file_ids": ["refused", "allowed"], "folder_id": "f"}
        ).json()["results"][0]["ok"]
        is False
    )
    assert fake.payloads[-1]["type"] == "user#download"
    assert fake.payloads[-1]["params"]["file_id"] == "allowed"
    fake.lose_create_response = True
    lost = client.post(
        "/api/v1/downloads", json={"urls": ["https://example.invalid/lost"], "name": "Recovered"}
    ).json()
    assert lost["results"][0]["ok"]
    assert len(fake.payloads) == 3  # No POST retry.


def test_slow_control_keeps_shared_snapshot_readable(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    fake, _ = runner
    fake.add("pending")
    fake.touch_delay = 0.6
    with ThreadPoolExecutor() as workers:
        request = workers.submit(client.post, "/api/v1/downloads/pause", json={"ids": ["pending"]})
        for _ in range(100):
            if ("GET", "/device/v1/touch_dltask") in fake.requests:
                break
            time.sleep(0.005)
        started = time.monotonic()
        detail = client.get("/api/v1/downloads/pending").json()
        assert time.monotonic() - started < 0.3
        assert detail["operation"]["status"] == "pending"
        assert request.result().json()["ok"]


def test_unknown_task_http_success_is_not_confirmation(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, _ = runner
    fake.add("no-effect")
    fake.touch_noop = True
    result = client.post("/api/v1/downloads/pause", json={"ids": ["no-effect"]}).json()
    assert result["results"][0]["status"] == "timeout"
    assert client.get("/api/v1/downloads/no-effect").json()["status"] == "running"


def test_local_business_error_is_not_http_success(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("business-error")
    original = fake.handler

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/device/v1/touch_dltask":
            return httpx.Response(200, json={"HttpStatus": 403, "error_description": "拒绝操作"})
        return await original(request)

    local = container.engine.client
    client.portal.call(local._http.aclose)  # type: ignore[union-attr]
    local._http = httpx.AsyncClient(
        base_url="http://fake-runner", transport=httpx.MockTransport(handler)
    )
    result = client.post("/api/v1/downloads/pause", json={"ids": ["business-error"]}).json()
    assert result["results"][0]["status"] == "failed"
    assert "拒绝操作" in result["results"][0]["message"]


def test_late_observed_transition_clears_timeout_feedback(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("late")
    fake.touch_noop = True
    assert (
        client.post("/api/v1/downloads/pause", json={"ids": ["late"]}).json()["results"][0][
            "status"
        ]
        == "timeout"
    )
    fake.transition("late", "PHASE_TYPE_PAUSED")
    container.engine.tasks.invalidate()
    task = client.get("/api/v1/downloads/late").json()
    assert task["status"] == "paused" and task["operation"]["status"] == "confirmed"
    assert task["operation"]["message"] == ""


def test_cloud_only_history_can_advance_without_losing_local_path(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    _, container = runner
    task = DriveTask.model_validate(
        {
            "id": "cloud-only",
            "type": "user#download-url",
            "phase": "PHASE_TYPE_PENDING",
            "params": {"real_path": "/downloads/history.bin", "url": "https://example.invalid/old"},
        }
    )
    client.get("/api/v1/downloads")
    container.engine.tasks.cloud = [task]
    container.engine.tasks.invalidate()
    assert client.get("/api/v1/downloads/cloud-only").json()["status"] == "queued"
    container.engine.tasks.cloud = [
        task.model_copy(update={"phase": "PHASE_TYPE_COMPLETE", "params": {}})
    ]
    container.engine.tasks.invalidate()
    updated = client.get("/api/v1/downloads/cloud-only").json()
    assert updated["status"] == "complete" and updated["local_path"] == "/downloads/history.bin"


def test_known_engine_account_mismatch_never_controls_other_account(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("mine")
    container.engine._snapshot = {"user": {"id": "someone-else"}}
    listed = client.get("/api/v1/downloads").json()
    assert not any(listed["tasks"][0]["capabilities"].values())
    result = client.post("/api/v1/downloads/pause", json={"ids": ["mine"]}).json()
    assert result["results"][0]["status"] == "unsupported"
    result = client.post(
        "/api/v1/downloads", json={"urls": ["https://example.invalid/test"]}
    ).json()
    assert not result["results"][0]["ok"]
    assert fake.requests == [] and fake.payloads == []


def test_creation_connect_failure_can_be_retried_without_ambiguous_lockout(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    original = fake.handler
    unavailable = True

    async def handler(request: httpx.Request) -> httpx.Response:
        if unavailable and request.method == "POST" and request.url.path == "/drive/v1/task":
            raise httpx.ConnectError("connection refused", request=request)
        return await original(request)

    local = container.engine.client
    client.portal.call(local._http.aclose)  # type: ignore[union-attr]
    local._http = httpx.AsyncClient(
        base_url="http://fake-runner", transport=httpx.MockTransport(handler)
    )
    body = {"urls": ["https://example.invalid/retry-connect"]}
    failed = client.post("/api/v1/downloads", json=body).json()
    assert not failed["results"][0]["ok"] and failed["results"][0]["status"] == "failed"
    unavailable = False
    retried = client.post("/api/v1/downloads", json=body).json()
    assert retried["results"][0]["ok"] and len(fake.payloads) == 1


def test_snapshot_epoch_changes_on_service_restart_and_account_switch(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    from app.services.engine.tasks import RunnerTasks

    fake, container = runner
    fake.add("versioned")
    before = client.get("/api/v1/downloads").json()
    action = client.post("/api/v1/downloads/pause", json={"ids": ["versioned"]}).json()
    assert before["epoch"] and action["epoch"] == before["epoch"]
    client.portal.call(container.engine.tasks.close)  # type: ignore[union-attr]
    container.engine.tasks = RunnerTasks(container.engine)
    after = client.get("/api/v1/downloads").json()
    assert after["epoch"] != before["epoch"] and after["version"] == 1
    assert after["tasks"][0]["status"] == "paused"
    container.api.credentials.user_id = "next-user"
    switched = client.get("/api/v1/downloads").json()
    assert switched["epoch"] != after["epoch"]


def test_live_failure_details_and_path_replace_stale_history(
    client: TestClient, runner: tuple[FakeRunner, Container]
) -> None:
    fake, container = runner
    fake.add("failure")
    fake.disk["failure"]["FullPath"] = "/downloads/old"
    assert client.get("/api/v1/downloads/failure").status_code == 200
    fake.memory["failure"]["phase"] = "PHASE_TYPE_ERROR"
    fake.memory["failure"]["message"] = "资源不可用"
    fake.memory["failure"]["params"].update(
        {"error": "资源已失效", "real_path": "/downloads/current"}
    )
    container.engine.tasks.invalidate()
    task = client.get("/api/v1/downloads/failure").json()
    assert task["status"] == "error" and task["error"] == "资源已失效"
    assert task["message"] == "资源不可用" and task["local_path"] == "/downloads/current"
