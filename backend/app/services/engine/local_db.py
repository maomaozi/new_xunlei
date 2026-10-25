"""Read-only, bounded Bolt/Gob snapshot of one explicitly selected Runner home.

No Storm indexes, credentials, user directories or guessed device IDs are searched.
The two Bolt meta pages are checksummed; a commit during capture causes a retry.
"""

import hashlib
import json
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

DB_NAME = "cc7bb060f8efc7462b6cbbb5f7a21015"
MAX_DATABASE_BYTES = 256 * 1024 * 1024


class LocalDatabaseError(ValueError):
    """An unreadable snapshot must never be represented as an empty inventory."""


@dataclass(frozen=True)
class LocalIdentity:
    home: str
    device_id: str
    platform: str
    user_id: str
    client_id: str
    client_secret: str = field(repr=False)
    instance_tag: str = ""

    @property
    def key(self) -> str:
        # Include the secret only in the one-way fingerprint, never in logs or API output.
        return hashlib.sha256(repr(self).encode() + self.client_secret.encode()).hexdigest()


@dataclass
class LocalSnapshot:
    tasks: list[dict[str, Any]]
    files: list[dict[str, Any]]
    txid: int


class Cursor:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def take(self, size: int) -> bytes:
        if size < 0 or self.pos + size > len(self.data):
            raise LocalDatabaseError("Truncated Gob record")
        result = self.data[self.pos : self.pos + size]
        self.pos += size
        return result

    def uint(self) -> int:
        value = self.take(1)[0]
        if value < 128:
            return value
        count = 256 - value
        if count > 8:
            raise LocalDatabaseError("Invalid Gob integer")
        return int.from_bytes(self.take(count), "big")

    def integer(self) -> int:
        value = self.uint()
        return ~(value >> 1) if value & 1 else value >> 1

    def string(self) -> str:
        return self.take(self.uint()).decode("utf-8")


class Gob:
    """Decode the wire's own type descriptors instead of assuming Go field positions."""

    def __init__(self) -> None:
        self.types: dict[int, tuple[str, Any]] = {}

    def common(self, cur: Cursor) -> None:
        index = -1
        while delta := cur.uint():
            index += delta
            if index == 0:
                cur.string()
            elif index == 1:
                cur.integer()
            else:
                raise LocalDatabaseError("Unknown Gob CommonType field")

    def descriptor(self, cur: Cursor) -> tuple[str, Any]:
        kind = cur.uint() - 1
        if kind not in (0, 1, 2, 3, 4, 5, 6):
            raise LocalDatabaseError("Unknown Gob wire type")
        index = -1
        fields: list[tuple[str, int]] = []
        element = key = 0
        while delta := cur.uint():
            index += delta
            if index == 0:
                self.common(cur)
            elif kind == 2 and index == 1:
                count = cur.uint()
                if count > 1024:
                    raise LocalDatabaseError("Oversized Gob struct")
                for _ in range(count):
                    name, tid, fi = "", 0, -1
                    while fd := cur.uint():
                        fi += fd
                        if fi == 0:
                            name = cur.string()
                        elif fi == 1:
                            tid = cur.integer()
                        else:
                            raise LocalDatabaseError("Unknown Gob field descriptor")
                    fields.append((name, tid))
            elif kind == 3 and index == 1:
                key = cur.integer()
            elif index == 1 or (kind == 3 and index == 2):
                element = cur.integer()
            elif kind == 0 and index == 2:
                cur.integer()  # Array length is also present in the value.
            else:
                raise LocalDatabaseError("Unsupported Gob descriptor")
        if cur.uint() != 0:
            raise LocalDatabaseError("Invalid Gob wire terminator")
        if kind == 2:
            return "struct", fields
        if kind == 3:
            return "map", (key, element)
        return ("array", element) if kind < 2 else ("external", 0)

    def value(self, tid: int, cur: Cursor, depth: int = 0) -> Any:
        if depth > 32:
            raise LocalDatabaseError("Gob nesting limit exceeded")
        if tid == 1:
            return bool(cur.uint())
        if tid == 2:
            return cur.integer()
        if tid == 3:
            return cur.uint()
        if tid == 4:
            return struct.unpack("<d", cur.uint().to_bytes(8, "big"))[0]
        if tid == 5:
            return cur.take(cur.uint())
        if tid == 6:
            return cur.string()
        if tid not in self.types:
            raise LocalDatabaseError(f"Unsupported Gob type {tid}")
        kind, schema = self.types[tid]
        if kind == "external":
            return cur.take(cur.uint())
        if kind == "struct":
            result: dict[str, Any] = {}
            index = -1
            while delta := cur.uint():
                index += delta
                if index >= len(schema):
                    raise LocalDatabaseError("Gob field outside descriptor")
                name, child = schema[index]
                result[name] = self.value(child, cur, depth + 1)
            return result
        count = cur.uint()
        if count > 100000:
            raise LocalDatabaseError("Gob collection limit exceeded")
        if kind == "array":
            return [self.value(schema, cur, depth + 1) for _ in range(count)]
        return {
            self.value(schema[0], cur, depth + 1): self.value(schema[1], cur, depth + 1)
            for _ in range(count)
        }

    def decode(self, data: bytes) -> dict[str, Any]:
        stream = Cursor(data)
        result: Any = None
        while stream.pos < len(data):
            cur = Cursor(stream.take(stream.uint()))
            tid = cur.integer()
            if tid < 0:
                self.types[-tid] = self.descriptor(cur)
            else:
                result = self.value(tid, cur)
            if cur.pos != len(cur.data):
                raise LocalDatabaseError("Trailing Gob message bytes")
        if not isinstance(result, dict):
            raise LocalDatabaseError("Expected a Gob struct")
        return result


def _fnv(data: bytes) -> int:
    value = 14695981039346656037
    for byte in data:
        value = ((value ^ byte) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return value


class Bolt:
    def __init__(self, data: bytes) -> None:
        self.data = data
        # Page size appears in the first meta. Accept the second valid meta if the first is bad.
        candidates = [4096, 8192, 16384, 32768, 65536]
        if len(data) >= 28:
            candidates.insert(0, struct.unpack_from("<I", data, 24)[0])
        metas: list[tuple[int, int, int, int]] = []
        for size in dict.fromkeys(candidates):
            if size < 1024 or size > 65536 or size & (size - 1):
                continue
            for page in (0, 1):
                offset = page * size + 16
                meta = data[offset : offset + 64]
                if len(meta) != 64:
                    continue
                magic, version, actual_size = struct.unpack_from("<III", meta)
                root, _, _, pgid, txid, checksum = struct.unpack_from("<QQQQQQ", meta, 16)
                if (
                    magic == 0xED0CDAED
                    and version == 2
                    and actual_size == size
                    and checksum == _fnv(meta[:56])
                    and root < pgid
                    and pgid * size <= len(data)
                ):
                    metas.append((txid, root, size, pgid))
        if not metas:
            raise LocalDatabaseError("No valid Bolt metadata page")
        self.txid, self.root, self.size, self.pgid = max(metas)

    def entries(
        self, page: int, *, inline: bytes | None = None, seen: set[int] | None = None
    ) -> list[tuple[int, bytes, bytes]]:
        visited = set() if seen is None else seen
        if inline is None:
            if page in visited or page >= self.pgid:
                raise LocalDatabaseError("Cyclic or invalid Bolt page")
            visited.add(page)
            offset = page * self.size
            header = self.data[offset : offset + 16]
        else:
            offset, header = 0, inline[:16]
        if len(header) != 16:
            raise LocalDatabaseError("Truncated Bolt page")
        _, flags, count, overflow = struct.unpack("<QHHI", header)
        buf = (
            inline
            if inline is not None
            else self.data[offset : offset + (overflow + 1) * self.size]
        )
        if len(buf) < 16 + count * 16:
            raise LocalDatabaseError("Truncated Bolt elements")
        result: list[tuple[int, bytes, bytes]] = []
        for index in range(count):
            pos = 16 + index * 16
            if flags == 1:
                _, _, child = struct.unpack_from("<IIQ", buf, pos)
                result.extend(self.entries(child, seen=visited))
            elif flags == 2:
                ef, start, ks, vs = struct.unpack_from("<IIII", buf, pos)
                start += pos
                if start < 16 + count * 16 or start + ks + vs > len(buf):
                    raise LocalDatabaseError("Invalid Bolt leaf bounds")
                result.append((ef, buf[start : start + ks], buf[start + ks : start + ks + vs]))
            else:
                raise LocalDatabaseError("Invalid Bolt page flags")
        return result

    def bucket_path(self, names: tuple[bytes, ...]) -> list[tuple[int, bytes, bytes]]:
        entries = self.entries(self.root)
        for name in names:
            selected = next(
                (value for flags, key, value in entries if flags & 1 and key == name), None
            )
            if selected is None:
                return []
            if len(selected) < 16:
                raise LocalDatabaseError("Invalid Bolt bucket")
            root = struct.unpack_from("<Q", selected)[0]
            entries = self.entries(root, inline=selected[16:] if root == 0 else None)
        return entries


def validate_identity(identity: LocalIdentity) -> None:
    """Bind memory and disk observations to the explicitly selected account/device."""
    info_path = Path(identity.home) / "info.file"
    if info_path.exists():
        info = json.loads(info_path.read_text())
        expected = {
            "device_id": identity.device_id,
            "user_id": identity.user_id,
            "platform": identity.platform,
            "client_id": identity.client_id,
        }
        if not isinstance(info, dict) or any(
            str(info.get(k, "")) != v for k, v in expected.items()
        ):
            raise LocalDatabaseError("Runner identity does not match the selected account/home")


def read_snapshot(identity: LocalIdentity) -> LocalSnapshot:
    """Blocking adapter: callers MUST use asyncio.to_thread."""
    if not identity.device_id or not identity.user_id or not identity.client_id:
        raise LocalDatabaseError("Runner instance identity is incomplete")
    validate_identity(identity)
    drive = Path(identity.home) / ".drive"
    path = drive / DB_NAME
    data = b""
    for _ in range(3):
        with path.open("rb") as file:
            size = file.seek(0, 2)
            if size > MAX_DATABASE_BYTES:
                raise LocalDatabaseError("Runner database exceeds snapshot limit")
            file.seek(0)
            before = file.read(131072)
            file.seek(0)
            data = file.read(size)
            file.seek(0)
            after = file.read(131072)
        if before == after and len(data) == size:
            break
    else:
        raise LocalDatabaseError("Runner database changed during capture")
    bolt = Bolt(data)
    inner = hashlib.md5(
        (identity.client_id + "jafkjasldfjfalsd" + identity.client_secret).encode()
    ).hexdigest()
    key = hashlib.md5((identity.device_id + inner).encode()).hexdigest().encode()

    def records(bucket: bytes) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        if bucket == b"LocalTaskInfo":
            names: tuple[bytes, ...] = (f"{identity.user_id}.taskinfo.db".encode(), bucket)
        else:
            names = (f"{identity.user_id}.files".encode(), b"files", bucket)
        for flags, name, value in bolt.bucket_path(names):
            if flags & 1 or name.startswith(b"__storm") or name in (b"id", b"__id"):
                continue
            if not value or len(value) % 16:
                raise LocalDatabaseError(f"Invalid encrypted {bucket.decode()} record")
            decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
            plain = decryptor.update(value) + decryptor.finalize()
            unpadder = padding.PKCS7(128).unpadder()
            try:
                plain = unpadder.update(plain) + unpadder.finalize()
                record = Gob().decode(plain)
            except (ValueError, UnicodeError, IndexError, struct.error) as error:
                raise LocalDatabaseError(f"Cannot decode {bucket.decode()} record") from error
            if bucket == b"LocalTaskInfo" and not record.get("TaskId"):
                raise LocalDatabaseError("Local task has no Runner TaskId")
            result.append(record)
        return result

    tasks: dict[str, dict[str, Any]] = {}
    for record in records(b"LocalTaskInfo"):
        tid = str(record["TaskId"])
        if tid not in tasks or int(record.get("ID", 0)) >= int(tasks[tid].get("ID", 0)):
            tasks[tid] = record
    return LocalSnapshot(list(tasks.values()), records(b"LocalFile"), bolt.txid)
