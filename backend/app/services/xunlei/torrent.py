"""Minimal bencode reader to convert .torrent files into magnet links."""

import hashlib
from dataclasses import dataclass, field
from urllib.parse import quote


class TorrentError(ValueError):
    pass


@dataclass
class TorrentFileEntry:
    index: int
    path: str
    size: int


@dataclass
class TorrentInfo:
    info_hash: str
    name: str
    total_size: int
    magnet: str
    files: list[TorrentFileEntry] = field(default_factory=list)
    trackers: list[str] = field(default_factory=list)


BencodeValue = int | bytes | list["BencodeValue"] | dict[bytes, "BencodeValue"]


def _decode(data: bytes, index: int) -> tuple[BencodeValue, int]:
    token = data[index : index + 1]
    if token == b"i":
        end = data.index(b"e", index)
        return int(data[index + 1 : end]), end + 1
    if token == b"l":
        index += 1
        items: list[BencodeValue] = []
        while data[index : index + 1] != b"e":
            item, index = _decode(data, index)
            items.append(item)
        return items, index + 1
    if token == b"d":
        index += 1
        mapping: dict[bytes, BencodeValue] = {}
        while data[index : index + 1] != b"e":
            key, index = _decode(data, index)
            if not isinstance(key, bytes):
                raise TorrentError("dictionary key must be a byte string")
            value, index = _decode(data, index)
            mapping[key] = value
        return mapping, index + 1
    if token.isdigit():
        colon = data.index(b":", index)
        length = int(data[index:colon])
        start = colon + 1
        return data[start : start + length], start + length
    raise TorrentError(f"invalid bencode token at {index}")


def _text(value: BencodeValue | None) -> str:
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else ""


def parse_torrent(data: bytes) -> TorrentInfo:
    try:
        root, _ = _decode(data, 0)
        if not isinstance(root, dict) or b"info" not in root:
            raise TorrentError("missing info dictionary")
        # The info hash must be computed over the original bytes of the info value.
        info_start = data.index(b"4:info") + 6
        _, info_end = _decode(data, info_start)
    except (IndexError, ValueError) as error:
        raise TorrentError("invalid torrent file") from error
    info = root[b"info"]
    if not isinstance(info, dict):
        raise TorrentError("info must be a dictionary")
    info_hash = hashlib.sha1(data[info_start:info_end]).hexdigest()
    name = _text(info.get(b"name.utf-8") or info.get(b"name")) or info_hash
    files: list[TorrentFileEntry] = []
    raw_files = info.get(b"files")
    if isinstance(raw_files, list):
        # The position in `files` is the BT file index Xunlei uses for sub-file selection.
        for index, entry in enumerate(raw_files):
            if not isinstance(entry, dict):
                continue
            parts = entry.get(b"path.utf-8") or entry.get(b"path")
            path = "/".join(_text(p) for p in parts) if isinstance(parts, list) else ""
            length = entry.get(b"length")
            size = length if isinstance(length, int) else 0
            files.append(TorrentFileEntry(index=index, path=path, size=size))
    else:
        length = info.get(b"length")
        size = length if isinstance(length, int) else 0
        files.append(TorrentFileEntry(index=0, path=name, size=size))
    trackers: list[str] = []
    announce = _text(root.get(b"announce"))
    if announce:
        trackers.append(announce)
    tiers = root.get(b"announce-list")
    if isinstance(tiers, list):
        for tier in tiers:
            for url in tier if isinstance(tier, list) else [tier]:
                text = _text(url)
                if text and text not in trackers:
                    trackers.append(text)
    magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(name)}"
    return TorrentInfo(
        info_hash=info_hash,
        name=name,
        total_size=sum(f.size for f in files),
        magnet=magnet,
        files=files,
        trackers=trackers,
    )
