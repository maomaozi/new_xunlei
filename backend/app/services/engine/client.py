"""HTTP client for the engine's loopback API (`DriveListen`)."""

import json
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError
from app.services.engine.tokens import LOCAL_SCOPE, UI_SCOPE, read_secret, sign_token

logger = logging.getLogger(__name__)

JsonObject = dict[str, Any]


class EngineClient:
    def __init__(self, port: int, drive_dir: Path) -> None:
        self.port = port
        self.drive_dir = drive_dir
        self._secret: bytes | None = None
        self._http = httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}",
            timeout=httpx.Timeout(15, connect=3),
            trust_env=False,
        )

    async def close(self) -> None:
        await self._http.aclose()

    def _token(self, scope: str) -> str:
        if self._secret is None:
            self._secret = read_secret(self.drive_dir)
        if self._secret is None:
            raise AppError("engine_unavailable", 503, "下载引擎尚未完成初始化，请稍后重试。")
        return sign_token(self._secret, scope)

    def forget_secret(self) -> None:
        self._secret = None

    async def request(
        self,
        method: str,
        path: str,
        *,
        scope: str = UI_SCOPE,
        params: Mapping[str, str | int] | None = None,
        json_body: object | None = None,
        limit: float | None = None,
    ) -> httpx.Response:
        token = self._token(scope)
        headers = (
            {"LocalToken": f"LocalToken {token}"} if scope == LOCAL_SCOPE else {"pan-auth": token}
        )
        try:
            response = await self._http.request(
                method,
                path,
                params=params,
                json=json_body,
                headers=headers,
                timeout=limit if limit is not None else httpx.USE_CLIENT_DEFAULT,
            )
        except httpx.TransportError as error:
            logger.debug("Engine request failed: %s %s: %r", method, path, error)
            raise AppError("engine_unavailable", 503) from error
        if response.status_code in (401, 403):
            # The secret is rewritten when the engine home is replaced; reload it once.
            self._secret = None
        return response

    async def call(
        self,
        method: str,
        path: str,
        *,
        scope: str = UI_SCOPE,
        params: Mapping[str, str | int] | None = None,
        json_body: object | None = None,
        limit: float | None = None,
    ) -> Any:
        response = await self.request(
            method, path, scope=scope, params=params, json_body=json_body, limit=limit
        )
        try:
            data = response.json() if response.content else {}
        except json.JSONDecodeError:
            data = {}
        if response.status_code >= 400:
            message = ""
            if isinstance(data, dict):
                message = str(data.get("error_description") or data.get("error") or "")
            logger.warning("Engine API %s %s -> %d %s", method, path, response.status_code, message)
            raise AppError("engine_error", 502, f"下载引擎返回错误：{message}" if message else None)
        return data

    # ----------------------------------------------------------------- local control

    async def status(self) -> JsonObject:
        data = await self.call("GET", "/device/status", scope=LOCAL_SCOPE, limit=5)
        return data if isinstance(data, dict) else {}

    async def local_config(self) -> JsonObject:
        data = await self.call("GET", "/device/v1/local_config", scope=LOCAL_SCOPE, limit=5)
        return data if isinstance(data, dict) else {}

    async def set_local_config(self, config: JsonObject) -> None:
        await self.call("POST", "/device/local_config", scope=LOCAL_SCOPE, json_body=config)

    async def control_url(self) -> str:
        data = await self.call("GET", "/device/control", scope=LOCAL_SCOPE, limit=5)
        return str(data.get("url") or "") if isinstance(data, dict) else ""

    # ------------------------------------------------------------------- device API

    async def qr_image(self) -> bytes:
        response = await self.request("GET", "/auth/qrlogin", limit=30)
        if response.status_code != 200 or not response.content.startswith(b"\x89PNG"):
            raise AppError("engine_error", 502, "下载引擎未能生成登录二维码。")
        return response.content

    async def qr_status(self) -> JsonObject:
        data = await self.call("GET", "/auth/qrlogin/status", limit=10)
        return data if isinstance(data, dict) else {}

    async def login_url(self) -> str:
        data = await self.call("GET", "/device/authlogin", limit=30)
        return data if isinstance(data, str) else ""

    async def signout(self) -> None:
        await self.call("POST", "/auth/signout")

    async def trial_info(self) -> JsonObject:
        data = await self.call("GET", "/device/v1/try_speed/get_info", limit=10)
        return data if isinstance(data, dict) else {}

    async def trial_config(self) -> JsonObject:
        data = await self.call("GET", "/device/v1/try_speed/get_config", limit=10)
        return data if isinstance(data, dict) else {}

    async def trial_apply(self) -> None:
        await self.call("POST", "/device/v1/try_speed/apply", json_body={}, limit=20)

    async def healthz(self) -> JsonObject:
        data = await self.call("GET", "/device/healthz", limit=5)
        return data if isinstance(data, dict) else {}

    async def list_local_files(self, space: str, parent_id: str) -> JsonObject:
        params: dict[str, str | int] = {"space": space, "parent_id": parent_id, "limit": 500}
        data = await self.call("GET", "/drive/v1/files", params=params, limit=20)
        return data if isinstance(data, dict) else {}
