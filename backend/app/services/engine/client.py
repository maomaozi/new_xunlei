"""HTTP client for the engine's loopback API (`DriveListen`)."""

import asyncio
import datetime
import json
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError
from app.services.engine.tokens import (
    LOCAL_SCOPE,
    UI_SCOPE,
    debug_passwd,
    read_secret,
    sign_token,
)

logger = logging.getLogger(__name__)

JsonObject = dict[str, Any]


class EngineRouteUnavailable(AppError):
    """An optional local route is absent on this engine platform."""

    def __init__(self, path: str) -> None:
        super().__init__("engine_error", 502, f"当前引擎平台不支持接口 {path}（HTTP 404）。")


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
        params: Mapping[str, str | int] | httpx.QueryParams | None = None,
        json_body: object | None = None,
        limit: float | None = None,
    ) -> httpx.Response:
        token = await asyncio.to_thread(self._token, scope)
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
            raise AppError(
                "engine_unavailable", 503, "无法连接下载引擎本地接口，请检查控制端口与引擎日志。"
            ) from error
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
        params: Mapping[str, str | int] | httpx.QueryParams | None = None,
        json_body: object | None = None,
        limit: float | None = None,
    ) -> Any:
        response = await self.request(
            method, path, scope=scope, params=params, json_body=json_body, limit=limit
        )
        if response.status_code == 404:
            raise EngineRouteUnavailable(path)
        try:
            data = response.json() if response.content else {}
        except json.JSONDecodeError:
            data = {}
        business_error = isinstance(data, dict) and (
            bool(data.get("error"))
            or (isinstance(data.get("HttpStatus"), int) and data["HttpStatus"] >= 400)
        )
        if response.status_code >= 400 or business_error:
            message = ""
            if isinstance(data, dict):
                message = str(data.get("error_description") or data.get("error") or "")
            logger.warning("Engine API %s %s -> %d %s", method, path, response.status_code, message)
            raise AppError(
                "engine_error",
                502,
                f"下载引擎接口 {path} 返回错误（HTTP {response.status_code}）"
                + (f"：{message}" if message else "。"),
            )
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

    async def debug_snapshot(self) -> JsonObject:
        """In-memory runner state (`/device/debug`): queued/running tasks with live progress.

        The password depends on the engine's local date; around midnight the neighbouring
        days are tried as well. The route answers 403 unless the engine logs at debug level
        (it starts at info), so a 403 switches the level once and retries.
        """
        today = datetime.date.today()
        for offset in (0, -1, 1):
            passwd = debug_passwd(today + datetime.timedelta(days=offset))
            response = await self._debug_get(passwd)
            if response.status_code == 403:
                await self.set_log_level("debug", passwd)
                response = await self._debug_get(passwd)
            if response.status_code == 401:
                continue
            if response.status_code != 200:
                logger.warning("Engine /device/debug -> %d", response.status_code)
                raise AppError("engine_error", 502, "下载引擎实时状态读取失败。")
            data = response.json()
            return data if isinstance(data, dict) else {}
        raise AppError("engine_error", 502, "下载引擎拒绝了实时状态查询。")

    async def _debug_get(self, passwd: str) -> httpx.Response:
        return await self.request(
            "GET", "/device/debug", scope=LOCAL_SCOPE, params={"passwd": passwd}, limit=5
        )

    async def set_log_level(self, level: str, passwd: str) -> None:
        """`/device/debug/loglevel/:level`; `debug` also starts Go pprof on control port + 2."""
        response = await self.request(
            "GET",
            f"/device/debug/loglevel/{level}",
            scope=LOCAL_SCOPE,
            params={"passwd": passwd},
            limit=5,
        )
        if response.status_code == 200:
            logger.info("Engine log level set to %s to unlock its debug routes", level)
        else:
            logger.warning("Engine log level change -> %d", response.status_code)

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

    async def trial_clean(self) -> None:
        """`/device/v1/try_speed/debug/clean`: resets the local trial count and timer."""
        await self.call("POST", "/device/v1/try_speed/debug/clean", json_body={}, limit=20)

    async def trial_apply(self) -> None:
        await self.call("POST", "/device/v1/try_speed/apply", json_body={}, limit=20)

    async def healthz(self) -> JsonObject:
        data = await self.call("GET", "/device/healthz", limit=5)
        return data if isinstance(data, dict) else {}

    async def list_local_files(self, space: str, parent_id: str) -> JsonObject:
        params: dict[str, str | int] = {"space": space, "parent_id": parent_id, "limit": 500}
        data = await self.call("GET", "/drive/v1/files", params=params, limit=20)
        return data if isinstance(data, dict) else {}

    async def touch_task(self, dl_task_id: str, event: str) -> JsonObject:
        data = await self.call(
            "GET",
            "/device/v1/touch_dltask",
            scope=LOCAL_SCOPE,
            params={"dltask_id": dl_task_id, "event": event},
        )
        return data if isinstance(data, dict) else {}

    async def create_task(self, payload: JsonObject) -> JsonObject:
        # Never retry POST: a lost response can still mean the task was created.
        data = await self.call("POST", "/drive/v1/task", json_body=payload)
        return data if isinstance(data, dict) else {}

    async def patch_task(self, task_id: str, task_type: str, space: str, paused: bool) -> None:
        await self.call(
            "PATCH",
            "/drive/v1/task",
            json_body={
                "kind": "drive#task",
                "id": task_id,
                "type": task_type,
                "space": space,
                "set_params": {"spec": json.dumps({"phase": "pause" if paused else "running"})},
            },
        )

    async def delete_tasks(self, ids: list[str], space: str) -> None:
        await self.call(
            "DELETE",
            "/drive/v1/tasks",
            params=httpx.QueryParams([*(("task_ids", tid) for tid in ids), ("space", space)]),
        )
