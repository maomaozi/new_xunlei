"""Minimal stand-in for the NAS package launcher that the engine consults for auth.

The engine reads `LauncherAddress` and calls `GET <address>/launcher/auth` with the caller's
`Pan-Auth` header; it accepts the request when the reply carries `StaticKey(token)`. The
engine has already verified the token signature itself, so the launcher only has to echo the
derived key. `/launcher/status` and `/launcher/version(s)` are forwarded by the engine's UI
routes and answered with static data.
"""

import asyncio
import json
import logging

from app.services.engine.tokens import static_key

logger = logging.getLogger(__name__)

MAX_HEADER_BYTES = 16 * 1024


class LauncherServer:
    def __init__(self, version: str) -> None:
        self.version = version
        self._server: asyncio.Server | None = None
        self.port = 0

    @property
    def running(self) -> bool:
        return self._server is not None

    async def start(self, port: int) -> None:
        if self._server is not None and self.port == port:
            return
        await self.stop()
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", port)
        self.port = port
        logger.info("Engine launcher listening on 127.0.0.1:%d", port)

    async def stop(self) -> None:
        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()
        self._server = None

    def _reply(self, path: str, headers: dict[str, str]) -> tuple[int, object]:
        route = path.split("?", 1)[0].rstrip("/")
        if route == "/launcher/auth":
            return 200, {"key": static_key(headers.get("pan-auth", ""))}
        if route == "/launcher/status":
            return 200, {"status": "running"}
        if route in ("/launcher/version", "/launcher/versions"):
            return 200, {"version": self.version, "versions": [self.version]}
        return 404, {"error": "not_found"}

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
            if len(raw) > MAX_HEADER_BYTES:
                return
            lines = raw.decode("latin-1").split("\r\n")
            parts = lines[0].split(" ")
            path = parts[1] if len(parts) > 1 else "/"
            headers: dict[str, str] = {}
            for line in lines[1:]:
                name, sep, value = line.partition(":")
                if sep:
                    headers[name.strip().lower()] = value.strip()
            status, body = self._reply(path, headers)
            payload = json.dumps(body).encode()
            writer.write(
                f"HTTP/1.1 {status} {'OK' if status == 200 else 'Not Found'}\r\n"
                "Content-Type: application/json\r\n"
                f"Content-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode()
                + payload
            )
            await writer.drain()
        except (TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, OSError):
            pass
        finally:
            writer.close()
