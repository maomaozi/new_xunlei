"""Small encrypted Bolt/Gob fixtures exercise account isolation and metadata selection."""

import hashlib
import json
import struct
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.services.engine.local_db import (
    DB_NAME,
    Bolt,
    LocalDatabaseError,
    LocalIdentity,
    read_snapshot,
)

PAGE = 4096


def uint(value: int) -> bytes:
    if value < 128:
        return bytes([value])
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return bytes([256 - len(raw)]) + raw


def integer(value: int) -> bytes:
    return uint(value * 2 if value >= 0 else (~value * 2) + 1)


def string(value: str) -> bytes:
    raw = value.encode()
    return uint(len(raw)) + raw


def gob_record(record: dict[str, str]) -> bytes:
    common = b"\x01" + string("Fixture") + b"\x01" + integer(64) + b"\x00"
    fields = b"".join(b"\x01" + string(k) + b"\x01" + integer(6) + b"\x00" for k in record)
    descriptor = (
        integer(-64) + b"\x03\x01" + common + b"\x01" + uint(len(record)) + fields + b"\x00\x00"
    )
    value = integer(64) + b"".join(b"\x01" + string(v) for v in record.values()) + b"\x00"
    return uint(len(descriptor)) + descriptor + uint(len(value)) + value


def leaf(items: list[tuple[bytes, bytes, int]], page_id: int = 0) -> bytes:
    header = struct.pack("<QHHI", page_id, 2, len(items), 0)
    table = bytearray()
    payload = bytearray()
    start = 16 + len(items) * 16
    for index, (key, value, flags) in enumerate(items):
        table.extend(
            struct.pack(
                "<IIII", flags, start + len(payload) - (16 + index * 16), len(key), len(value)
            )
        )
        payload.extend(key + value)
    return header + table + payload


def bucket(name: str, items: list[tuple[bytes, bytes, int]]) -> tuple[bytes, bytes, int]:
    return name.encode(), struct.pack("<QQ", 0, 0) + leaf(items), 1


def meta(page: int, root: int, txid: int, freelist: int) -> bytes:
    raw = struct.pack("<IIIIQQQQQ", 0xED0CDAED, 2, PAGE, 0, root, 0, freelist, 4, txid)
    checksum = 14695981039346656037
    for byte in raw:
        checksum = ((checksum ^ byte) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return (struct.pack("<QHHI", page, 4, 0, 0) + raw + struct.pack("<Q", checksum)).ljust(
        PAGE, b"\x00"
    )


def fixture_db(tmp_path: Path) -> tuple[LocalIdentity, Path]:
    identity = LocalIdentity(str(tmp_path), "device", "qnap", "alice", "client", "secret")
    (tmp_path / "info.file").write_text(
        json.dumps(
            {
                "device_id": identity.device_id,
                "platform": identity.platform,
                "user_id": identity.user_id,
                "client_id": identity.client_id,
            }
        )
    )
    inner = hashlib.md5(b"clientjafkjasldfjfalsdsecret").hexdigest()
    key = hashlib.md5(("device" + inner).encode()).hexdigest().encode()

    def encrypted(record: dict[str, str]) -> bytes:
        pad = padding.PKCS7(128).padder()
        data = pad.update(gob_record(record)) + pad.finalize()
        cipher = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
        return cipher.update(data) + cipher.finalize()

    def user_records(user: str) -> list[tuple[bytes, bytes, int]]:
        task = encrypted(
            {"TaskId": user + "-task", "DLTaskId": user + "-kernel", "Phase": "PHASE_TYPE_PAUSED"}
        )
        file = encrypted({"TaskId": user + "-task", "RealPath": "/downloads/" + user})
        return [
            bucket(user + ".taskinfo.db", [bucket("LocalTaskInfo", [(b"1", task, 0)])]),
            bucket(user + ".files", [bucket("files", [bucket("LocalFile", [(b"1", file, 0)])])]),
        ]

    # The stale meta has a larger freelist ID: selecting that field as txid is incorrect.
    old = leaf(user_records("bob"), 2).ljust(PAGE, b"\x00")
    current = leaf(user_records("bob") + user_records("alice"), 3).ljust(PAGE, b"\x00")
    data = meta(0, 2, 10, 999) + meta(1, 3, 11, 0) + old + current
    path = tmp_path / ".drive" / DB_NAME
    path.parent.mkdir()
    path.write_bytes(data)
    return identity, path


def test_actual_encrypted_nested_buckets_are_account_scoped(tmp_path: Path) -> None:
    identity, _ = fixture_db(tmp_path)
    snapshot = read_snapshot(identity)
    assert snapshot.txid == 11
    assert [t["TaskId"] for t in snapshot.tasks] == ["alice-task"]
    assert [t["DLTaskId"] for t in snapshot.tasks] == ["alice-kernel"]
    assert [f["RealPath"] for f in snapshot.files] == ["/downloads/alice"]


def test_bad_new_meta_uses_valid_previous_commit(tmp_path: Path) -> None:
    _, path = fixture_db(tmp_path)
    data = bytearray(path.read_bytes())
    data[PAGE + 16 + 56] ^= 1
    bolt = Bolt(bytes(data))
    assert bolt.txid == 10 and bolt.root == 2
    data[16 + 56] ^= 1
    with pytest.raises(LocalDatabaseError, match="metadata"):
        Bolt(bytes(data))


def test_wrong_key_and_wrong_identity_are_not_empty_inventory(tmp_path: Path) -> None:
    from dataclasses import replace

    identity, _ = fixture_db(tmp_path)
    with pytest.raises(LocalDatabaseError, match="decode"):
        read_snapshot(replace(identity, client_secret="wrong-secret"))
    with pytest.raises(LocalDatabaseError, match="identity"):
        read_snapshot(replace(identity, user_id="bob"))
