import hashlib
from pathlib import Path

import httpx
import pytest

from app.db.connection import Database
from app.db.migrations import apply_migrations
from app.repositories.settings import SettingsRepository
from app.services.settings_store import SettingsStore
from app.services.xunlei.gcid import calc_gcid, gcid_block_size
from app.services.xunlei.http import pin_host
from app.services.xunlei.oss import OssError, OssTarget
from app.services.xunlei.torrent import TorrentError, parse_torrent


def test_gcid_block_size_tiers() -> None:
    assert gcid_block_size(1) == 0x40000
    assert gcid_block_size(0x8000000) == 0x40000
    assert gcid_block_size(0x8000001) == 0x80000
    assert gcid_block_size(0x20000000) == 0x100000
    assert gcid_block_size(0x20000001) == 0x200000


def test_gcid_hashes_block_digests(tmp_path: Path) -> None:
    data = b"a" * (0x40000 + 10)
    path = tmp_path / "f.bin"
    path.write_bytes(data)
    blocks = hashlib.sha1(data[:0x40000]).digest() + hashlib.sha1(data[0x40000:]).digest()
    assert calc_gcid(path) == hashlib.sha1(blocks).hexdigest().upper()


def test_torrent_to_magnet() -> None:
    info = b"d6:lengthi1024e4:name8:demo.iso12:piece lengthi16384e6:pieces20:" + b"x" * 20 + b"e"
    data = b"d8:announce14:http://tracker4:info" + info + b"e"
    parsed = parse_torrent(data)
    assert parsed.info_hash == hashlib.sha1(info).hexdigest()
    assert parsed.name == "demo.iso"
    assert parsed.total_size == 1024
    assert parsed.magnet.startswith(f"magnet:?xt=urn:btih:{parsed.info_hash}")


def test_invalid_torrent() -> None:
    with pytest.raises(TorrentError):
        parse_torrent(b"not a torrent")


def test_pin_host_keeps_sni_and_host_header() -> None:
    url, headers, extensions = pin_host(
        httpx.URL("https://api-pan.xunlei.com/drive/v1/about"),
        {"api-pan.xunlei.com": "101.91.143.206"},
    )
    assert url.host == "101.91.143.206"
    assert headers == {"Host": "api-pan.xunlei.com"}
    assert extensions == {"sni_hostname": "api-pan.xunlei.com"}
    untouched, none, _ = pin_host(httpx.URL("https://example.com/x"), {})
    assert untouched.host == "example.com" and none == {}


def test_oss_target_requires_complete_credentials() -> None:
    params: dict[str, object] = {
        "endpoint": "https://up.xdrive.xunlei.com",
        "bucket": "b",
        "key": "/k/v",
        "access_key_id": "id",
        "access_key_secret": "secret",
        "security_token": "token",
    }
    target = OssTarget.from_params(params)
    assert target.url == "https://b.up.xdrive.xunlei.com/k/v"
    assert target.headers("PUT")["Authorization"].startswith("OSS id:")
    with pytest.raises(OssError):
        OssTarget.from_params({**params, "security_token": ""})


def test_invalid_stored_section_falls_back_to_defaults(tmp_path: Path) -> None:
    db = Database(tmp_path / "x.sqlite3")
    apply_migrations(db)
    repo = SettingsRepository(db)
    repo.save({"ui": {"accent": "not-a-color"}, "drive": {"page_size": 300}})
    store = SettingsStore(repo)
    assert store.current.ui.accent == "#5b7cfa"
    assert store.current.drive.page_size == 300
