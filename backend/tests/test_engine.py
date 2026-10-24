import asyncio
import base64
import datetime
import hashlib
import hmac
import json
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi.testclient import TestClient

from app.schemas.xunlei import DriveTask
from app.services.engine.client import EngineClient
from app.services.engine.launcher import LauncherServer
from app.services.engine.process import find_binary, host_arch, rotate_log, tail_log
from app.services.engine.service import (
    overlay,
    parse_indexes,
    parse_live,
    remove_inside,
    to_download,
)
from app.services.engine.tokens import (
    SECRET_FILE,
    SECRET_KEY,
    debug_passwd,
    read_secret,
    sign_token,
    static_key,
)


def _encrypt(secret: bytes) -> bytes:
    pad = 16 - len(secret) % 16
    encryptor = Cipher(algorithms.AES(SECRET_KEY), modes.ECB()).encryptor()
    return encryptor.update(secret + bytes([pad]) * pad) + encryptor.finalize()


def test_secret_roundtrip_and_token_signature(tmp_path: Path) -> None:
    (tmp_path / SECRET_FILE).write_bytes(_encrypt(b"0123456789abcdef0123456789abcdef"))
    secret = read_secret(tmp_path)
    assert secret == b"0123456789abcdef0123456789abcdef"
    token = sign_token(secret, "UIAuth", ttl=60, now=1000)
    header, claims, signature = token.split(".")
    expected = hmac.new(secret, f"{header}.{claims}".encode(), hashlib.sha256).digest()
    assert base64.urlsafe_b64decode(signature + "==") == expected
    payload = json.loads(base64.urlsafe_b64decode(claims + "=="))
    assert payload == {"key": "UIAuth", "sub": "UIAuth", "exp": 1060, "iat": 1000, "nbf": 1000}
    assert read_secret(tmp_path / "missing") is None


def test_static_key_matches_engine_algorithm() -> None:
    # The algorithm was confirmed live against xunlei-pan-cli 3.23.3; pin it.
    assert static_key("abc") == "2e5108fcb8f460f002685d543210d4e7"
    assert static_key("abc") != static_key("abd")


def test_launcher_answers_auth_with_static_key() -> None:
    async def run() -> tuple[bytes, bytes]:
        server = LauncherServer(version="3.23.3")
        await server.start(0)
        assert server._server is not None
        port = server._server.sockets[0].getsockname()[1]

        async def get(path: str) -> bytes:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(f"GET {path} HTTP/1.1\r\nPan-Auth: tok\r\n\r\n".encode())
            await writer.drain()
            data = await reader.read()
            writer.close()
            return data

        auth = await get("/launcher/auth")
        missing = await get("/nope")
        await server.stop()
        return auth, missing

    auth, missing = asyncio.run(run())
    assert auth.startswith(b"HTTP/1.1 200")
    assert json.loads(auth.split(b"\r\n\r\n", 1)[1]) == {"key": static_key("tok")}
    assert missing.startswith(b"HTTP/1.1 404")


def test_find_binary_prefers_configured_then_arch(tmp_path: Path) -> None:
    arch = host_arch()
    other = "amd64" if arch == "arm64" else "arm64"
    (tmp_path / f"xunlei-pan-cli.3.1.0.{other}").write_text("")
    assert find_binary("", [tmp_path]) is None
    wanted = tmp_path / f"xunlei-pan-cli.3.23.3.{arch}"
    wanted.write_text("")
    assert find_binary("", [tmp_path / "missing", tmp_path]) == wanted
    assert find_binary(str(tmp_path / "nope"), [tmp_path]) is None


def test_task_mapping_and_indexes() -> None:
    task = DriveTask.model_validate(
        {
            "id": "t1",
            "name": "a.iso",
            "type": "user#download-url",
            "phase": "PHASE_TYPE_RUNNING",
            "progress": 40,
            "file_size": "1000",
            "params": {
                "speed": "2048",
                "real_path": "/d/a.iso",
                "speedup": '{"p2p":"started","vip":"close","super":"close"}',
                "sub_file_index": "0-2,5",
            },
        }
    )
    item = to_download(task)
    assert item.status == "running" and item.source == "link"
    assert item.done_bytes == 400 and item.speed == 2048
    assert item.speedup.p2p == "started" and item.local_path == "/d/a.iso"
    assert parse_indexes(item.sub_files) == [0, 1, 2, 5]
    paused = to_download(task.model_copy(update={"phase": "PHASE_TYPE_PAUSED"}))
    assert paused.status == "paused" and paused.speed == 0


def test_remove_inside_only_touches_download_roots(tmp_path: Path) -> None:
    root = tmp_path / "dl"
    (root / "folder").mkdir(parents=True)
    (root / "folder" / "x").write_text("x")
    (root / "file").write_text("y")
    outside = tmp_path / "keep"
    outside.write_text("z")
    removed = remove_inside([root / "folder", root / "file", outside, root], [root])
    assert removed == 2
    assert not (root / "folder").exists() and not (root / "file").exists()
    assert outside.exists() and root.exists()


def test_tail_log(tmp_path: Path) -> None:
    log = tmp_path / "engine.log"
    log.write_text("".join(f"line {i}\n" for i in range(100)))
    lines = tail_log(log, 30)
    assert lines[-1] == "line 99" and all(line.startswith("line") for line in lines)
    assert tail_log(tmp_path / "none", 10) == []


def test_engine_api_without_running_engine(client: TestClient) -> None:
    status = client.get("/api/v1/engine").json()
    assert status["state"] in ("stopped", "missing_binary")
    assert status["space"].startswith("device_id#")
    response = client.get("/api/v1/engine/login/status")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "engine_unavailable"


def test_engine_settings_reject_duplicate_ports(client: TestClient) -> None:
    settings = client.get("/api/v1/settings").json()
    settings["engine"]["launcher_port"] = settings["engine"]["control_port"]
    assert client.put("/api/v1/settings", json=settings).status_code == 422


def test_download_create_requires_single_url_for_files(client: TestClient) -> None:
    body = {"urls": ["magnet:?a", "magnet:?b"], "files": [0]}
    assert client.post("/api/v1/downloads", json=body).status_code == 422


def test_debug_password_matches_engine() -> None:
    # Value accepted by the running engine on 2026-10-24 (utils.CheckDebugPasswd).
    assert debug_passwd(datetime.date(2026, 10, 24)) == "19a3e0a2aa35da0ed55588f4d3807bb3"


def test_live_snapshot_overrides_stale_cloud_progress() -> None:
    snapshot = {
        "Running": {"t1": True},
        "Process": [
            {
                "id": "t1",
                "name": "a.mkv",
                "phase": "PHASE_TYPE_RUNNING",
                "progress": 49.47125,
                "file_size": "1000",
                "params": {"speed": "4084831", "speedup_speed": "10", "real_path": "/d/a.mkv"},
            },
            {"id": "t2", "phase": "PHASE_TYPE_PENDING", "progress": 0, "params": {"speed": "9"}},
        ],
    }
    live = parse_live(snapshot)
    assert live.running == 1 and live.speed == 4084831
    first, second = live.tasks
    assert first.progress == 49.47 and first.done_bytes == 494 and first.running
    assert second.status == "queued" and second.speed == 0
    cloud = to_download(
        DriveTask.model_validate(
            {"id": "t1", "type": "user#download", "phase": "PHASE_TYPE_RUNNING", "progress": 0}
        )
    )
    merged = overlay(cloud, first)
    assert merged.progress == 49.47 and merged.speed == 4084831 and merged.size == 1000
    assert merged.local_path == "/d/a.mkv" and merged.source == "cloud"


def test_live_route_is_not_shadowed_by_task_route(client: TestClient) -> None:
    response = client.get("/api/v1/downloads/live")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "engine_unavailable"


def test_debug_snapshot_unlocks_debug_level_on_403(tmp_path: Path) -> None:
    (tmp_path / SECRET_FILE).write_bytes(_encrypt(b"0123456789abcdef0123456789abcdef"))
    calls: list[str] = []
    unlocked = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal unlocked
        calls.append(request.url.path)
        assert request.headers["LocalToken"].startswith("LocalToken ")
        if request.url.path == "/device/debug/loglevel/debug":
            unlocked = True
            return httpx.Response(200, json={})
        if not unlocked:
            return httpx.Response(403, json={"error": "permission_denied"})
        return httpx.Response(200, json={"Process": [], "Running": {}})

    async def run() -> dict[str, object]:
        client = EngineClient(5075, tmp_path)
        await client._http.aclose()
        client._http = httpx.AsyncClient(
            base_url="http://127.0.0.1:5075", transport=httpx.MockTransport(handler)
        )
        try:
            return await client.debug_snapshot()
        finally:
            await client.close()

    assert asyncio.run(run()) == {"Process": [], "Running": {}}
    assert calls == ["/device/debug", "/device/debug/loglevel/debug", "/device/debug"]


def test_rotate_log_copies_and_truncates(tmp_path: Path) -> None:
    log = tmp_path / "engine.log"
    log.write_bytes(b"x" * 100)
    assert not rotate_log(log, 1000)
    assert rotate_log(log, 50)
    assert log.stat().st_size == 0 and (tmp_path / "engine.log.1").stat().st_size == 100


def test_trial_clean_needs_running_engine(client: TestClient) -> None:
    response = client.post("/api/v1/engine/trial/clean")
    assert response.status_code == 503
