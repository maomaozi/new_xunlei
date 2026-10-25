"""Shared engine authentication; all HTTP transports are local fakes."""

import asyncio
import base64
import hashlib
import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi.testclient import TestClient

from app.core.errors import AppError
from app.repositories.account import AccountRepository, StoredCredentials
from app.services.container import Container
from app.services.engine.auth import read_access_token
from app.services.engine.process import EngineProcess


def container_for(client: TestClient) -> Container:
    return client.app.state.container  # type: ignore[attr-defined,no-any-return]


def credential(token: str = "engine-access", user: str = "engine-user") -> StoredCredentials:
    return StoredCredentials(
        access_token=token,
        expires_at=time.time() + 3600,
        user_id=user,
        device_id="engine-device",
        source="engine",
    )


def encrypt(data: object, key: bytes) -> bytes:
    padder = padding.PKCS7(128).padder()
    plain = padder.update(json.dumps(data).encode()) + padder.finalize()
    enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return base64.b64encode(enc.update(plain) + enc.finalize())


def test_innerweb_token_protocol() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "127.0.0.1" and request.url.port == 21607
        assert request.url.path == "/fetch"
        timestamp = request.url.params["xllite_t"]
        key = hashlib.md5(f"xllite_fetch:{timestamp}".encode()).hexdigest().encode()
        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        plain = dec.update(base64.b64decode(request.content)) + dec.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        body = json.loads(unpadder.update(plain) + unpadder.finalize())
        assert body["type"] == "action.get_token" and body["data"] == ""
        return httpx.Response(
            200,
            content=encrypt(
                {
                    "ret": 1,
                    "call_id": body["call_id"],
                    "data": json.dumps({"access_token": "live-token", "expire_at": 2000000000}),
                },
                key,
            ),
        )

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            data = await read_access_token(http, 21607)
            assert data["access_token"] == "live-token"

    asyncio.run(run())


@pytest.mark.parametrize("content", [b"not ciphertext", b"", encrypt({"ret": 0}, b"a" * 32)])
def test_invalid_innerweb_response_is_structured(content: bytes) -> None:
    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=content))
        ) as http:
            with pytest.raises(AppError) as error:
                await read_access_token(http, 21607)
            assert error.value.code == "engine_unavailable"

    asyncio.run(run())


def test_tokens_follow_engine_and_never_persist(client: TestClient) -> None:
    container = container_for(client)
    current = credential()

    async def provider() -> StoredCredentials:
        return replace(current)

    container.api.engine_credentials = provider
    assert client.get("/api/v1/account").json()["logged_in"]
    current = credential("rotated-access", "switched-user")
    assert client.post("/api/v1/account/refresh").json()["user_id"] == "switched-user"
    assert container.api.credentials.access_token == "rotated-access"
    saved = AccountRepository(container.db).load()
    assert saved.source == "engine" and saved.user_id == "switched-user"
    assert not saved.access_token and not saved.refresh_token

    async def unavailable() -> StoredCredentials:
        raise AppError("engine_unavailable", 503)

    container.api.engine_credentials = unavailable
    status = client.get("/api/v1/account").json()
    assert not status["logged_in"] and not status["token_valid"]
    assert not container.api.credentials.access_token
    assert client.get("/api/v1/files").status_code == 503


def test_cloud_401_reads_new_engine_token_without_oauth_refresh(client: TestClient) -> None:
    container = container_for(client)
    issued = 0
    calls: list[str] = []

    async def provider() -> StoredCredentials:
        nonlocal issued
        issued += 1
        return credential(f"access-{issued}")

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        assert request.headers["X-Device-Id"] == "engine-device"
        if request.headers["Authorization"] == "Bearer access-1":
            return httpx.Response(401, json={"error": "unauthorized"})
        assert request.headers["Authorization"] == "Bearer access-2"
        return httpx.Response(200, json={"files": []})

    container.api.engine_credentials = provider
    assert client.portal is not None
    client.portal.call(container.api._client.aclose)
    container.api._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert client.get("/api/v1/files").status_code == 200
    assert calls == ["/drive/v1/files", "/drive/v1/files"]


def test_logout_clears_engine_and_backend(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    container = container_for(client)
    signed_in = True

    async def provider() -> StoredCredentials:
        if not signed_in:
            raise AppError("auth_required", 401)
        return credential()

    async def signout() -> None:
        nonlocal signed_in
        signed_in = False

    async def refresh() -> None:
        pass

    container.api.engine_credentials = provider
    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: True))
    monkeypatch.setattr(container.engine.client, "signout", signout)
    monkeypatch.setattr(container.engine, "_refresh", refresh)
    assert client.get("/api/v1/account").json()["logged_in"]
    assert client.post("/api/v1/account/logout").status_code == 200
    assert not signed_in and not container.api.credentials.access_token
    assert not client.get("/api/v1/account").json()["logged_in"]


@pytest.mark.parametrize("expired", [False, True])
def test_engine_identity_and_expiry(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    expired: bool,
) -> None:
    container = container_for(client)
    engine = container.engine
    engine.home.mkdir(parents=True)
    (engine.home / "info.file").write_text(json.dumps({"device_id": "actual-engine-device"}))

    async def access_credentials(port: int) -> dict[str, Any]:
        assert port == engine.config.public_port
        return {
            "access_token": "access",
            "user_id": "user",
            "cli.device_space": "",
            "expire_at": time.time() + (-1 if expired else 3600),
        }

    monkeypatch.setattr(EngineProcess, "alive", property(lambda _: True))
    monkeypatch.setattr(engine.client, "access_credentials", access_credentials)
    response = client.post("/api/v1/account/refresh")
    if expired:
        assert response.status_code == 401
        assert not container.api.credentials.access_token
    else:
        assert response.status_code == 200
        assert response.json()["device_id"] == "actual-engine-device"


def test_pending_read_cannot_restore_logged_out_token(client: TestClient) -> None:
    api = container_for(client).api

    async def run() -> None:
        started, finish = asyncio.Event(), asyncio.Event()

        async def provider() -> StoredCredentials:
            started.set()
            await finish.wait()
            return credential()

        api.engine_credentials = provider
        task = asyncio.create_task(api.sync_engine_credentials())
        await started.wait()
        api.clear_credentials()
        finish.set()
        with pytest.raises(AppError):
            await task
        assert not api.credentials.access_token

    assert client.portal is not None
    client.portal.call(run)


def test_session_switch_does_not_change_running_launch_spec(client: TestClient) -> None:
    container = container_for(client)
    launched = container.engine.spec()
    container.engine.process.spec = launched

    async def provider() -> StoredCredentials:
        return credential(user="new-engine-user")

    container.api.engine_credentials = provider
    assert client.post("/api/v1/account/refresh").status_code == 200
    assert container.api.credentials.user_id == "new-engine-user"
    assert container.engine.spec() == launched


def test_legacy_app_tokens_are_retired_on_restart(client: TestClient, tmp_path: Path) -> None:
    from app.services.xunlei.api import XunleiApi

    container = container_for(client)
    repo = AccountRepository(container.db)
    repo.save(
        StoredCredentials(
            access_token="old-access",
            refresh_token="old-refresh",
            source="import",
            device_id="keep-device",
            user_id="old-user",
        )
    )
    api = XunleiApi(container.settings, repo)
    assert api.credentials.source == "engine" and api.device_id == "keep-device"
    assert not api.has_credentials
    assert not repo.load().refresh_token and not repo.load().access_token
    assert client.portal is not None
    client.portal.call(api.close)
