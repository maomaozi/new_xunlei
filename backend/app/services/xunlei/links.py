"""Helpers for download links (magnet / http / ftp / ed2k)."""

import os
import urllib.parse
from collections.abc import Iterable

MAX_TRACKERS = 20


def guess_name(url: str) -> str:
    """Display name of a link: magnet `dn`, ed2k file name or the URL's last path segment."""
    if url.startswith("magnet:"):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        if query.get("dn"):
            return query["dn"][0]
        return ""
    if url.startswith("ed2k://"):
        parts = url.split("|")
        return urllib.parse.unquote(parts[2]) if len(parts) > 2 else ""
    return urllib.parse.unquote(os.path.basename(url.split("?")[0].rstrip("/")))


def with_trackers(magnet: str, trackers: Iterable[str]) -> str:
    """Append `tr=` parameters so the engine can fetch torrent metadata without DHT luck."""
    unique = list(dict.fromkeys(t for t in trackers if t.startswith(("http", "udp", "wss"))))
    extra = "".join(f"&tr={urllib.parse.quote(t, safe='')}" for t in unique[:MAX_TRACKERS])
    return magnet + extra
