from pathlib import Path

from fastapi.testclient import TestClient


def test_health_and_structured_errors(client: TestClient) -> None:
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    missing = client.get("/api/v1/missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_drive_requires_login_without_contacting_xunlei(client: TestClient) -> None:
    response = client.get("/api/v1/files")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "engine_unavailable"


def test_independent_login_routes_are_removed(client: TestClient) -> None:
    for path in ("import", "import/file", "password", "qrcode"):
        assert client.post(f"/api/v1/account/{path}", json={}).status_code == 404
    assert client.put("/api/v1/account/device", json={}).status_code == 404
    assert client.get("/api/v1/account/qrcode/old-session").status_code == 404


def test_settings_roundtrip_validation_and_reset(client: TestClient) -> None:
    settings = client.get("/api/v1/settings").json()
    settings["download"]["connections_per_file"] = 8
    saved = client.put("/api/v1/settings", json=settings).json()
    assert saved["download"]["connections_per_file"] == 8

    settings["ui"]["accent"] = "blue"
    assert client.put("/api/v1/settings", json=settings).status_code == 422

    reset = client.post("/api/v1/settings/download/reset").json()
    assert reset["download"]["connections_per_file"] == 4


def test_settings_persist_across_restarts(tmp_path: Path) -> None:
    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        app_env="test", data_dir=tmp_path, frontend_dist=None, engine_autostart=False
    )
    with TestClient(create_app(settings)) as first:
        value = first.get("/api/v1/settings").json()
        value["drive"]["page_size"] = 200
        value["engine"]["platform"] = "linux"
        assert first.put("/api/v1/settings", json=value).status_code == 200
    with TestClient(create_app(settings)) as second:
        saved = second.get("/api/v1/settings").json()
        assert saved["drive"]["page_size"] == 200
        assert saved["engine"]["platform"] == "linux"


def test_bulk_transfer_route_is_not_shadowed(client: TestClient) -> None:
    assert client.post("/api/v1/transfers/bulk/clear-finished").status_code == 200
    assert client.post("/api/v1/transfers/missing/pause").status_code == 404


def test_browser_upload_is_queued(client: TestClient) -> None:
    response = client.put(
        "/api/v1/transfers/uploads/stream",
        params={"name": "a.txt", "relative_dir": "x/y"},
        content=b"hello",
    )
    assert response.status_code == 200
    item = response.json()
    assert item["kind"] == "upload" and item["size"] == 5
    listed = client.get("/api/v1/transfers").json()
    assert [i["id"] for i in listed["items"]] == [item["id"]]


def test_fs_browser_is_limited_to_roots(client: TestClient, tmp_path: Path) -> None:
    settings = client.get("/api/v1/settings").json()
    settings["system"]["browse_roots"] = [str(tmp_path)]
    client.put("/api/v1/settings", json=settings)
    (tmp_path / "sub").mkdir()
    listing = client.get("/api/v1/system/fs", params={"path": str(tmp_path)}).json()
    assert "sub" in [e["name"] for e in listing["entries"]]
    outside = client.get("/api/v1/system/fs", params={"path": "/etc"})
    assert outside.status_code == 403
    assert outside.json()["error"]["code"] == "path_not_allowed"
