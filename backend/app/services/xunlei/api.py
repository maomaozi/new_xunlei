"""Async Xunlei Pan API, a typed port of the project's `xunlei_client.py`.

Protocol details (endpoints, payloads, IP pinning, CDN user agent, GCID) come from
reversing xunlei-pan-cli 3.23.3; see the repository's progress.md and USAGE.md.
"""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Literal

import httpx

from app.core.errors import AppError
from app.repositories.account import AccountRepository, StoredCredentials
from app.schemas.settings import AppSettings
from app.schemas.xunlei import (
    About,
    DriveFile,
    DriveTask,
    EventList,
    FileList,
    ResourceList,
    ShareCreated,
    ShareList,
    TaskList,
)
from app.services.settings_store import SettingsStore
from app.services.xunlei.captcha import captcha_sign, compress_indexes
from app.services.xunlei.http import (
    JsonObject,
    QueryParams,
    XunleiApiError,
    build_client,
    decode_json,
    send_with_retry,
)

logger = logging.getLogger(__name__)

# Tasks created this recently with the same source are taken as a lost POST's result.
LOST_TASK_WINDOW = 300
ALL_PHASES = "PHASE_TYPE_PENDING,PHASE_TYPE_RUNNING,PHASE_TYPE_ERROR,PHASE_TYPE_COMPLETE"
BatchAction = Literal["batchMove", "batchCopy", "batchTrash", "batchUntrash", "batchDelete"]
Category = Literal["video", "image", "audio", "document", "archive", "app"]

CATEGORY_FILTERS: dict[Category, dict[str, object]] = {
    "video": {"mime_type": {"prefix": "video/"}},
    "image": {"mime_type": {"prefix": "image/"}},
    "audio": {"mime_type": {"prefix": "audio/"}},
    "document": {"category": {"eq": "TEXT"}},
    "archive": {"category": {"eq": "ARCHIVE"}},
    "app": {"category": {"eq": "APP"}},
}


_closing: set[asyncio.Task[None]] = set()


def _timestamp(value: str) -> float:
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return 0.0


def _close_later(client: httpx.AsyncClient) -> None:
    task = asyncio.ensure_future(client.aclose())
    _closing.add(task)
    task.add_done_callback(_closing.discard)


class XunleiApi:
    def __init__(self, settings: SettingsStore, accounts: AccountRepository) -> None:
        self._settings = settings
        self._accounts = accounts
        previous = accounts.load()
        self._creds = StoredCredentials(
            device_id=previous.device_id or uuid.uuid4().hex,
            user_id=previous.user_id,
            source="engine",
        )
        # Independent app sessions are retired; the engine owns all token material.
        self._accounts.save(self._creds)
        self._client = build_client(settings.current.network)
        self._transfer_client = build_client(settings.current.network, keepalive=False)
        self._token_lock = asyncio.Lock()
        self._auth_epoch = 0
        self.engine_credentials: Callable[[], Awaitable[StoredCredentials]] | None = None
        # (action, device_id, user_id) -> (captcha_token, expires_at)
        self._captcha_tokens: dict[tuple[str, str, str], tuple[str, float]] = {}
        settings.subscribe(self._on_settings_changed)

    # ------------------------------------------------------------------ lifecycle

    def _on_settings_changed(self, value: AppSettings) -> None:
        old = (self._client, self._transfer_client)
        self._client = build_client(value.network)
        self._transfer_client = build_client(value.network, keepalive=False)
        try:
            # Let in-flight requests on the previous clients finish before closing them.
            loop = asyncio.get_running_loop()
            for client in old:
                loop.call_later(600, _close_later, client)
        except RuntimeError:
            pass

    async def close(self) -> None:
        await self._client.aclose()
        await self._transfer_client.aclose()

    @property
    def http(self) -> httpx.AsyncClient:
        return self._client

    @property
    def transfer_http(self) -> httpx.AsyncClient:
        """Client without keep-alive for CDN downloads, OSS uploads and streaming."""
        return self._transfer_client

    @property
    def config(self) -> AppSettings:
        return self._settings.current

    # ---------------------------------------------------------------- credentials

    @property
    def credentials(self) -> StoredCredentials:
        return self._creds

    @property
    def device_id(self) -> str:
        return self._creds.device_id

    @property
    def device_space(self) -> str:
        """Task space of the local engine, which runs under this account's device id."""
        engine = self.config.engine
        if engine.platform == "linux" and engine.device_space:
            return engine.device_space
        return f"device_id#{self._creds.device_id}"

    @property
    def has_credentials(self) -> bool:
        return bool(self._creds.access_token or self._creds.refresh_token)

    async def sync_engine_credentials(self) -> None:
        if self.engine_credentials is None:
            raise AppError("engine_unavailable", 503)
        async with self._token_lock:
            previous = self._creds
            epoch = self._auth_epoch
            try:
                credentials = await self.engine_credentials()
            except AppError:
                if self._auth_epoch == epoch:
                    self.clear_credentials()
                raise
            if self._auth_epoch != epoch:
                raise AppError("auth_required", 401)
            if (previous.user_id, previous.device_id) != (
                credentials.user_id,
                credentials.device_id,
            ):
                self._captcha_tokens.clear()
                saved = self._accounts.save(replace(credentials, access_token="", refresh_token=""))
                credentials.updated_at = saved.updated_at
            else:
                credentials.updated_at = previous.updated_at
            self._creds = credentials

    def clear_credentials(self) -> None:
        self._auth_epoch += 1
        self._creds = replace(self._creds, access_token="", refresh_token="", expires_at=0)
        self._captcha_tokens.clear()

    async def _access_token(self) -> str:
        await self.sync_engine_credentials()
        return self._creds.access_token

    # -------------------------------------------------------------------- transport

    def _base_headers(self) -> dict[str, str]:
        return {"X-Device-Id": self._creds.device_id}

    async def _auth_call(
        self,
        method: str,
        path: str,
        *,
        json: object | None = None,
        params: Mapping[str, str] | None = None,
        bearer: bool = False,
    ) -> JsonObject:
        network = self.config.network
        for attempt in range(2 if bearer else 1):
            token = await self._access_token() if bearer else ""
            headers = self._base_headers()
            if bearer:
                headers["Authorization"] = f"Bearer {token}"
            response = await send_with_retry(
                self._client,
                network,
                method,
                f"{network.auth_host}{path}",
                json=json,
                params=params,
                headers=headers,
            )
            if bearer and response.status_code == 401 and attempt == 0:
                await response.aclose()
                continue
            return decode_json(response)
        raise AppError("auth_failed", 401)

    async def pan(
        self,
        method: str,
        path: str,
        *,
        params: QueryParams = None,
        json: object | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> JsonObject:
        network = self.config.network
        for attempt in range(2):
            token = await self._access_token()
            response = await send_with_retry(
                self._client,
                network,
                method,
                f"{network.pan_host}{path}",
                params=params,
                json=json,
                headers={
                    **self._base_headers(),
                    "Authorization": f"Bearer {token}",
                    **(headers or {}),
                },
            )
            if response.status_code == 401 and attempt == 0:
                await response.aclose()
                continue
            return decode_json(response)
        raise AppError("auth_failed", 401)

    async def captcha_token(self, action: str, *, fresh: bool = False) -> str:
        """Signed `captcha_token` that guarded endpoints expect in `X-Captcha-Token`."""
        await self._access_token()
        key = (action, self._creds.device_id, self._creds.user_id)
        cached = self._captcha_tokens.get(key)
        if cached and not fresh and cached[1] > time.time():
            return cached[0]
        account = self.config.account
        timestamp = int(time.time() * 1000)
        sign = captcha_sign(
            account.client_id,
            account.client_version,
            account.package_name,
            self._creds.device_id,
            timestamp,
        )
        data = await self._auth_call(
            "POST",
            "/v1/shield/captcha/init",
            json={
                "client_id": account.client_id,
                "action": action,
                "device_id": self._creds.device_id,
                "meta": {
                    "captcha_sign": sign,
                    "client_version": account.client_version,
                    "package_name": account.package_name,
                    "timestamp": str(timestamp),
                    "user_id": self._creds.user_id,
                },
            },
        )
        token = str(data.get("captcha_token") or "")
        if not token:
            logger.warning("Captcha init for %s returned no token: %s", action, sorted(data))
            raise AppError("xunlei_error", 403, "迅雷要求完成人机验证，暂时无法解析该链接。")
        ttl = float(data.get("expires_in") or 300)
        self._captcha_tokens[key] = (token, time.time() + max(ttl - 30, 0))
        return token

    async def user_me(self) -> JsonObject:
        return await self._auth_call("GET", "/v1/user/me", bearer=True)

    # ------------------------------------------------------------------------ drive

    async def about(self) -> About:
        return About.model_validate(await self.pan("GET", "/drive/v1/about"))

    async def list_files(
        self,
        parent_id: str = "",
        *,
        page_token: str = "",
        limit: int = 100,
        trashed: bool = False,
        starred: bool | None = None,
        category: Category | None = None,
    ) -> FileList:
        filters: dict[str, object] = {"trashed": {"eq": trashed}}
        if starred is not None:
            filters["starred"] = {"eq": starred}
        if category is not None:
            filters.update(CATEGORY_FILTERS[category])
        params: dict[str, str | int] = {
            "parent_id": parent_id,
            "limit": limit,
            "with_audit": "true",
            "filters": json.dumps(filters),
        }
        if page_token:
            params["page_token"] = page_token
        return FileList.model_validate(await self.pan("GET", "/drive/v1/files", params=params))

    async def get_file(self, file_id: str) -> DriveFile:
        return DriveFile.model_validate(await self.pan("GET", f"/drive/v1/files/{file_id}"))

    async def download_link(self, file_id: str) -> tuple[DriveFile, str]:
        info = await self.get_file(file_id)
        url = info.web_content_link
        if not url:
            for name, link in info.links.items():
                if link.url and (name == "download" or not url):
                    url = link.url
        return info, url

    async def create_folder(self, name: str, parent_id: str = "") -> DriveFile:
        data = await self.pan(
            "POST",
            "/drive/v1/files",
            json={"kind": "drive#folder", "name": name, "parent_id": parent_id},
        )
        return DriveFile.model_validate(data.get("file") or data)

    async def find_child_folder(self, parent_id: str, name: str) -> DriveFile | None:
        page_token = ""
        while True:
            listing = await self.list_files(parent_id, page_token=page_token, limit=500)
            for item in listing.files:
                if item.is_folder and item.name == name:
                    return item
            page_token = listing.next_page_token
            if not page_token:
                return None

    async def ensure_folder_path(self, parent_id: str, parts: Sequence[str]) -> str:
        current = parent_id
        for part in parts:
            existing = await self.find_child_folder(current, part)
            current = existing.id if existing else (await self.create_folder(part, current)).id
        return current

    async def rename(self, file_id: str, name: str) -> DriveFile:
        data = await self.pan("PATCH", f"/drive/v1/files/{file_id}", json={"name": name})
        return DriveFile.model_validate(data)

    async def batch(self, action: BatchAction, ids: list[str], to_parent: str | None = None) -> str:
        payload: dict[str, object] = {"ids": ids}
        if to_parent is not None:
            payload["to"] = {"parent_id": to_parent}
        data = await self.pan("POST", f"/drive/v1/files:{action}", json=payload)
        return str(data.get("task_id", ""))

    async def set_starred(self, ids: list[str], starred: bool) -> None:
        await self.pan(
            "POST", f"/drive/v1/files:{'star' if starred else 'unstar'}", json={"ids": ids}
        )

    async def empty_trash(self) -> str:
        data = await self.pan("PATCH", "/drive/v1/files/trash:empty")
        return str(data.get("task_id", ""))

    async def create_upload(self, name: str, parent_id: str, size: int, gcid: str) -> JsonObject:
        return await self.pan(
            "POST",
            "/drive/v1/files",
            json={
                "kind": "drive#file",
                "name": name,
                "parent_id": parent_id,
                "size": str(size),
                "hash": gcid,
                "upload_type": "UPLOAD_TYPE_RESUMABLE",
            },
        )

    # ------------------------------------------------------------------------ tasks

    async def list_resources(self, url: str) -> ResourceList:
        """Sub-file tree of a magnet/BT/HTTP link (`POST /drive/v1/resource/list`)."""
        action = "POST:/drive/v1/resource/list"
        for attempt in range(2):
            token = await self.captcha_token(action, fresh=attempt > 0)
            try:
                data = await self.pan(
                    "POST",
                    "/drive/v1/resource/list",
                    json={"urls": url, "page_size": 2000},
                    headers={"X-Captcha-Token": token},
                )
            except XunleiApiError as error:
                if error.remote_error == "captcha_invalid" and attempt == 0:
                    continue
                raise
            return ResourceList.model_validate(data)
        raise AppError("xunlei_error", 502)

    async def offline_add(
        self, url: str, name: str = "", parent_id: str = "", files: Sequence[int] | None = None
    ) -> DriveTask:
        target: dict[str, object] = {"url": url}
        if files:
            # Cloud add selects BT sub-files via `url.files`; `params.sub_file_index` is ignored.
            target["files"] = [str(index) for index in sorted(set(files))]
        data = await self.pan(
            "POST",
            "/drive/v1/files",
            json={
                "kind": "drive#file",
                "name": name,
                "upload_type": "UPLOAD_TYPE_URL",
                "url": target,
                "parent_id": parent_id,
                "folder_type": "",
            },
        )
        return DriveTask.model_validate(data.get("task") or {})

    async def engine_add(
        self,
        url: str,
        name: str,
        *,
        folder_id: str = "",
        files: Sequence[int] | None = None,
    ) -> DriveTask:
        """`user#download-url` task picked up by the engine serving `device_space`."""
        params = {"url": url, "target": self.device_space}
        if folder_id:
            params["parent_folder_id"] = folder_id
        if files:
            params["sub_file_index"] = compress_indexes(files)
        return await self._create_engine_task("user#download-url", name, params)

    async def engine_fetch(self, file_id: str, name: str, *, folder_id: str = "") -> DriveTask:
        """`user#download` task: the engine pulls a cloud file or folder (VIP accelerated)."""
        params = {"file_id": file_id, "target": self.device_space}
        if folder_id:
            params["parent_folder_id"] = folder_id
        return await self._create_engine_task("user#download", name, params)

    async def _create_engine_task(
        self, task_type: str, name: str, params: dict[str, str]
    ) -> DriveTask:
        space = self.device_space
        payload = {
            "type": task_type,
            "name": name,
            "file_name": name,
            "file_size": "0",
            "space": space,
            "params": params,
        }
        try:
            data = await self.pan("POST", "/drive/v1/task", json=payload)
        except AppError as error:
            # The request may have been applied even though its response was lost.
            if error.code != "xunlei_unreachable":
                raise
            found = await self._find_new_task(task_type, name, params)
            if found is None:
                raise
            logger.info("Recovered task %s whose creation response was lost", found.id)
            return found
        return DriveTask.model_validate(data.get("task") or data)

    async def _find_new_task(
        self, task_type: str, name: str, params: Mapping[str, str]
    ) -> DriveTask | None:
        key = "file_id" if task_type == "user#download" else "url"
        cutoff = time.time() - LOST_TASK_WINDOW
        for _ in range(3):
            try:
                page = await self.list_tasks(
                    task_type=None, space=self.device_space, types=(task_type,), limit=50
                )
            except AppError:
                await asyncio.sleep(1)
                continue
            for task in page.tasks:
                created = _timestamp(task.created_time)
                if (
                    task.name == name
                    and task.params.get(key) == params.get(key)
                    and created >= cutoff
                ):
                    return task
            return None
        return None

    async def update_task(
        self, task: DriveTask, set_params: Mapping[str, str], space: str | None = None
    ) -> None:
        """`PATCH /drive/v1/task`; the engine reacts to `spec` = {"phase": running|pause}."""
        await self.pan(
            "PATCH",
            "/drive/v1/task",
            json={
                "kind": "drive#task",
                "id": task.id,
                "type": task.type,
                "space": space or task.space,
                "set_params": dict(set_params),
            },
        )

    async def list_tasks(
        self,
        *,
        task_type: str | None,
        space: str | None = None,
        phases: str = ALL_PHASES,
        page_token: str = "",
        limit: int = 100,
        types: Sequence[str] = (),
    ) -> TaskList:
        filters: dict[str, object] = {"phase": {"in": phases}}
        if types:
            filters["type"] = {"in": ",".join(types)}
        params: dict[str, str | int] = {"limit": limit, "filters": json.dumps(filters)}
        if task_type:
            params["type"] = task_type
        if space:
            params["space"] = space
        if page_token:
            params["page_token"] = page_token
        return TaskList.model_validate(await self.pan("GET", "/drive/v1/tasks", params=params))

    async def get_task(self, task_id: str, space: str | None = None) -> DriveTask:
        params = {"space": space} if space else None
        return DriveTask.model_validate(
            await self.pan("GET", f"/drive/v1/tasks/{task_id}", params=params)
        )

    async def delete_tasks(
        self, task_ids: list[str], *, delete_files: bool, space: str | None = None
    ) -> None:
        params: list[tuple[str, str]] = [("task_ids", tid) for tid in task_ids]
        if space:
            params.insert(0, ("space", space))
        params.append(("delete_files", "true" if delete_files else "false"))
        await self.pan("DELETE", "/drive/v1/tasks", params=params)

    # ----------------------------------------------------------------------- shares

    async def create_share(
        self,
        file_ids: list[str],
        *,
        expiration_days: int,
        pass_code: str,
        use_pass_code: bool,
        restore_limit: int,
        title: str,
    ) -> ShareCreated:
        payload: dict[str, object] = {
            "file_ids": file_ids,
            "share_to": "copy",
            "title": title,
            "expiration_days": str(expiration_days),
            "restore_limit": str(restore_limit),
            "params": {
                "subscribe_push": "false",
                "WithPassCodeInLink": "true" if use_pass_code else "false",
            },
        }
        if not use_pass_code:
            payload["pass_code_option"] = "NOT_REQUIRED"
        elif pass_code:
            payload["custom_pass_code"] = pass_code
        return ShareCreated.model_validate(await self.pan("POST", "/drive/v1/share", json=payload))

    async def list_shares(self, page_token: str = "", limit: int = 50) -> ShareList:
        params: dict[str, str | int] = {"limit": limit}
        if page_token:
            params["page_token"] = page_token
        return ShareList.model_validate(
            await self.pan("GET", "/drive/v1/share/list", params=params)
        )

    async def delete_shares(self, share_ids: list[str]) -> None:
        await self.pan("POST", "/drive/v1/share:batchDelete", json={"ids": share_ids})

    # ----------------------------------------------------------------------- events

    async def list_events(self, page_token: str = "", limit: int = 50) -> EventList:
        params: dict[str, str | int] = {"limit": limit}
        if page_token:
            params["page_token"] = page_token
        return EventList.model_validate(await self.pan("GET", "/drive/v1/events", params=params))
