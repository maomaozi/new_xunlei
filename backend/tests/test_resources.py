import asyncio
import json
import time
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.api.v1.offline import resource_preview
from app.db.connection import Database
from app.db.migrations import apply_migrations
from app.repositories.account import AccountRepository, StoredCredentials
from app.repositories.settings import SettingsRepository
from app.schemas.xunlei import ResourceList
from app.services.settings_store import SettingsStore
from app.services.xunlei.api import XunleiApi
from app.services.xunlei.captcha import captcha_sign, compress_indexes
from app.services.xunlei.torrent import parse_torrent

BT_TREE = {
    "list": {
        "resources": [
            {
                "name": "Movie",
                "file_size": "300",
                "is_dir": True,
                "dir": {
                    "resources": [
                        {"name": "a.srt", "file_size": "100", "file_index": 0},
                        {
                            "name": "extras",
                            "is_dir": True,
                            "dir": {
                                "resources": [
                                    {"name": "b.jpg", "file_size": "200", "file_index": 1}
                                ]
                            },
                        },
                    ]
                },
            }
        ]
    }
}


def test_captcha_sign_matches_reversed_vector() -> None:
    sign = captcha_sign(
        "X9ibISwpIp8jQ4Ya",
        "3.23.3",
        "pan.xunlei.cli.synology",
        "0123456789abcdef0123456789abcdef",
        1700000000000,
    )
    assert sign == "1.bc9a10e133b1a56dcc1affe153c88d52"


def test_compress_indexes() -> None:
    assert compress_indexes([5, 0, 1, 2, 7, 8, 10, 1]) == "0-2,5,7-8,10"
    assert compress_indexes([3]) == "3"


def test_torrent_files_keep_bt_indexes() -> None:
    files = b"ld6:lengthi1e4:pathl5:a.txteed6:lengthi2e4:pathl3:sub5:b.txteee"
    info = b"d5:files" + files + b"4:name4:pack12:piece lengthi16384e6:pieces20:" + b"x" * 20 + b"e"
    parsed = parse_torrent(b"d4:info" + info + b"e")
    assert [(f.index, f.path, f.size) for f in parsed.files] == [
        (0, "a.txt", 1),
        (1, "sub/b.txt", 2),
    ]


def test_resource_preview_flattens_bt_tree() -> None:
    preview = resource_preview(ResourceList.model_validate(BT_TREE).page.resources)
    assert preview.name == "Movie" and preview.total_size == 300
    assert [(f.index, f.path, f.size) for f in preview.files] == [
        (0, "a.srt", 100),
        (1, "extras/b.jpg", 200),
    ]


def test_files_require_single_url(client: TestClient) -> None:
    body = {"urls": ["magnet:?a", "magnet:?b"], "files": [0]}
    assert client.post("/api/v1/offline/tasks", json=body).status_code == 422
    assert (
        client.post("/api/v1/offline/tasks", json={"urls": ["x"], "files": []}).status_code == 422
    )


def _api(tmp_path: Path, handler: httpx.MockTransport) -> XunleiApi:
    db = Database(tmp_path / "x.sqlite3")
    apply_migrations(db)
    accounts = AccountRepository(db)
    accounts.save(
        StoredCredentials(
            access_token="token", expires_at=time.time() + 3600, user_id="42", device_id="dev"
        )
    )
    api = XunleiApi(SettingsStore(SettingsRepository(db)), accounts)
    api._client = httpx.AsyncClient(transport=handler)
    return api


def test_resource_list_signs_caches_and_renews_captcha(tmp_path: Path) -> None:
    calls: list[tuple[str, dict[str, object], str]] = []
    issued = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal issued
        body = json.loads(request.content or b"{}")
        calls.append((request.url.path, body, request.headers.get("X-Captcha-Token", "")))
        if request.url.path == "/v1/shield/captcha/init":
            issued += 1
            return httpx.Response(200, json={"captcha_token": f"ck{issued}", "expires_in": 300})
        if request.headers.get("X-Captcha-Token") == "ck1" and issued == 1 and len(calls) > 2:
            return httpx.Response(400, json={"error": "captcha_invalid"})
        return httpx.Response(200, json=BT_TREE)

    async def run() -> None:
        api = _api(tmp_path, httpx.MockTransport(handler))
        await api.list_resources("magnet:?xt=1")
        await api.list_resources("magnet:?xt=2")
        await api.close()

    asyncio.run(run())
    paths = [path for path, _, _ in calls]
    assert paths == [
        "/v1/shield/captcha/init",
        "/drive/v1/resource/list",
        "/drive/v1/resource/list",  # cached token rejected
        "/v1/shield/captcha/init",
        "/drive/v1/resource/list",
    ]
    init = calls[0][1]
    meta = init["meta"]
    assert isinstance(meta, dict)
    assert init["action"] == "POST:/drive/v1/resource/list" and init["device_id"] == "dev"
    assert meta["user_id"] == "42" and str(meta["captcha_sign"]).startswith("1.")
    assert calls[1][2] == "ck1" and calls[4][2] == "ck2"


def test_selected_files_payloads(tmp_path: Path) -> None:
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"task": {"id": "t1"}})

    async def run() -> None:
        api = _api(tmp_path, httpx.MockTransport(handler))
        await api.offline_add("magnet:?x", "", "", [2, 0])
        await api.engine_add("magnet:?x", "n", folder_id="f1", files=[0, 1, 2, 5])
        await api.close()

    asyncio.run(run())
    assert bodies[0]["url"] == {"url": "magnet:?x", "files": ["0", "2"]}
    params = bodies[1]["params"]
    assert isinstance(params, dict) and params["sub_file_index"] == "0-2,5"
    assert params["parent_folder_id"] == "f1"
    assert bodies[1]["type"] == "user#download-url"
    assert params["target"] == bodies[1]["space"]
