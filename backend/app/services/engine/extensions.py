"""Native mount management and remote control isolated from local inventory and files."""

import asyncio
import json
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from app.core.errors import AppError
from app.schemas.engine_extensions import (
    RemoteTaskCreate,
    RemoteTaskResult,
    StorageCreate,
    StorageList,
    StorageMount,
    StorageType,
    StorageTypes,
)
from app.schemas.xunlei import DriveTask, TaskList
from app.services.engine.client import EngineRouteUnavailable

if TYPE_CHECKING:
    from app.services.engine.service import EngineService


def sensitive(key: str) -> bool:
    return any(word in key.lower() for word in ("password", "secret", "token", "credential"))


class EngineExtensions:
    def __init__(self, service: "EngineService") -> None:
        self.service = service
        self._storage_lock = asyncio.Lock()

    def _identity(self) -> tuple[Path, str, str, str, int]:
        return (
            self.service.home,
            self.service.config.platform,
            self.service.api.device_id,
            self.service.api.credentials.user_id,
            self.service.api._auth_epoch,
        )

    def _check_identity(self, identity: tuple[Path, str, str, str, int]) -> None:
        if identity != self._identity():
            raise AppError("engine_instance_changed", 409)

    async def _call(
        self,
        feature: str,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        body: object | None = None,
    ) -> dict[str, Any]:
        if not getattr(self.service.capabilities(), feature):
            raise AppError("invalid_request", 409, "当前平台不支持此操作。")
        client = self.service.require_running()
        identity = self._identity()
        await self.service.ensure_launcher()
        self._check_identity(identity)
        try:
            data = await client.call(method, path, params=params, json_body=body, limit=20)
        except EngineRouteUnavailable:
            if path in ("/device/v1/vfs", "/device/v1/vfs_types") and method == "GET":
                self.service._storage_supported = False
            raise
        self._check_identity(identity)
        if not isinstance(data, dict):
            raise AppError("engine_error", 502, "引擎返回了无效数据。")
        if data.get("code") not in (None, 0, "0"):
            raise AppError("engine_error", 502, str(data.get("message") or "存储操作失败。"))
        return data

    async def storage_types(self) -> StorageTypes:
        data = await self._call("storage", "GET", "/device/v1/vfs_types")
        return StorageTypes(
            types=[StorageType.model_validate(row) for row in data.get("vfs_types", [])]
        )

    async def storage_list(self, page_token: str = "") -> StorageList:
        data = await self._call(
            "storage", "GET", "/device/v1/vfs", params={"page_token": page_token}
        )
        mounts = []
        for row in data.get("vfs_list", []):
            config = row.get("config") or {}
            public = {str(k): str(v) for k, v in config.items() if not sensitive(str(k))}
            name = str(config.get("name") or config.get("server") or "")
            if not name:
                name = PurePosixPath(str(config.get("mount_path") or "/")).name
            mounts.append(
                StorageMount(
                    id=str(row["id"]),
                    file_id=str(row.get("file_id") or ""),
                    type=str(row["type"]),
                    name=name,
                    config=public,
                )
            )
        return StorageList(mounts=mounts, next_page_token=str(data.get("next_page_token") or ""))

    async def _validate_storage(
        self, kind: str, config: dict[str, str], *, partial: bool = False
    ) -> None:
        types = await self.storage_types()
        template = next((item for item in types.types if item.type == kind), None)
        if template is None:
            raise AppError("invalid_request", 422, "请选择引擎支持的存储类型。")
        allowed = {field.key for field in template.config_templates}
        if set(config) - allowed:
            raise AppError("invalid_request", 422, "存储配置包含不支持的字段。")
        for field in template.config_templates:
            value = config.get(field.key, str(field.value))
            if field.required and not value and not partial:
                raise AppError("invalid_request", 422, f"请填写{field.title}。")
            if len(value) > field.max_length:
                raise AppError("invalid_request", 422, f"{field.title}过长。")

    async def storage_create(self, request: StorageCreate) -> None:
        identity = self._identity()
        await self._validate_storage(request.type, request.config)
        self._check_identity(identity)
        await self._call("storage", "POST", "/device/v1/vfs", body=request.model_dump())

    async def storage_update(self, mount_id: str, config: dict[str, str]) -> None:
        path = "/device/v1/vfs/" + quote(mount_id, safe="")
        async with self._storage_lock:
            identity = self._identity()
            existing = await self._call("storage", "GET", path)
            row = existing.get("vfs", existing)
            original = dict(row.get("config") or {})
            # A blank password in an edit form preserves the native stored credential.
            updates = {key: value for key, value in config.items() if value or not sensitive(key)}
            await self._validate_storage(str(row.get("type") or ""), updates, partial=True)
            original.update(updates)
            self._check_identity(identity)
            await self._call("storage", "POST", path, body={"id": mount_id, "config": original})

    async def storage_remove(self, mount_id: str) -> None:
        # Native unmount only: never delete user files or reuse local task cleanup.
        await self._call("storage", "DELETE", "/device/v1/vfs/" + quote(mount_id, safe=""))

    def _remote_space(self, device_id: str) -> str:
        if not self.service.capabilities().remote_devices:
            raise AppError("invalid_request", 409, "当前平台不支持此操作。")
        if device_id == self.service.api.device_id or not any(
            device.device_id == device_id for device in self.service.config.remote_devices
        ):
            raise AppError("invalid_request", 404, "请先在引擎设置中添加远程设备。")
        return f"device_id#{device_id}"

    async def remote_tasks(
        self, device_id: str, page_token: str = "", *, task_id: str = ""
    ) -> TaskList:
        space = self._remote_space(device_id)
        filters = {"type": {"in": "user#download-url,user#download"}}
        if task_id:
            filters["id"] = {"in": task_id}
        data = await self._call(
            "remote_devices",
            "GET",
            "/drive/v1/tasks",
            params={
                "space": space,
                "limit": 100,
                "filters": json.dumps(filters),
                "page_token": page_token,
            },
        )
        result = TaskList.model_validate(data)
        # Never pass another namespace's entries through a remote response.
        result.tasks = [
            task
            for task in result.tasks
            if (not task.space or task.space == space)
            and task.type in ("user#download-url", "user#download")
            and (not task_id or task.id == task_id)
        ]
        return result

    async def remote_create(self, device_id: str, request: RemoteTaskCreate) -> DriveTask:
        space = self._remote_space(device_id)
        if not request.url.startswith(
            ("http://", "https://", "magnet:", "ed2k:", "ftp://", "thunder://")
        ):
            raise AppError("invalid_request", 422, "请输入有效的下载链接。")
        data = await self._call(
            "remote_devices",
            "POST",
            "/drive/v1/task",
            body={
                "type": "user#download-url",
                "name": request.name,
                "file_name": request.name,
                "file_size": "0",
                "space": space,
                "params": {"url": request.url, "target": space},
            },
        )
        task = DriveTask.model_validate(data.get("task", data))
        if not task.id:
            raise AppError("engine_error", 502, "任务提交结果待确认，请刷新任务列表。")
        return task

    async def remote_action(self, device_id: str, task_id: str, action: str) -> RemoteTaskResult:
        identity = self._identity()
        space = self._remote_space(device_id)
        before = await self.remote_tasks(device_id, task_id=task_id)
        task = next((task for task in before.tasks if task.id == task_id), None)
        if task is None:
            raise AppError("not_found", 404)
        self._check_identity(identity)
        if action == "delete":
            await self._call(
                "remote_devices",
                "DELETE",
                "/drive/v1/tasks",
                params={"task_ids": task_id, "space": space},
            )
        else:
            await self._call(
                "remote_devices",
                "PATCH",
                "/drive/v1/task",
                body={
                    "kind": "drive#task",
                    "id": task_id,
                    "type": task.type,
                    "space": space,
                    "set_params": {
                        "spec": json.dumps({"phase": "pause" if action == "pause" else "running"})
                    },
                },
            )
        for attempt in range(3):
            self._check_identity(identity)
            after = await self.remote_tasks(device_id, task_id=task_id)
            current = next((task for task in after.tasks if task.id == task_id), None)
            confirmed = (
                current is None and not after.next_page_token
                if action == "delete"
                else bool(
                    current
                    and (
                        current.phase == "PHASE_TYPE_PAUSED"
                        if action == "pause"
                        else current.phase
                        in ("PHASE_TYPE_PENDING", "PHASE_TYPE_RUNNING", "PHASE_TYPE_COMPLETE")
                    )
                )
            )
            if confirmed:
                return RemoteTaskResult(confirmed=True, tasks=after.tasks)
            if attempt < 2:
                await asyncio.sleep(0.3)
        return RemoteTaskResult(confirmed=False, tasks=after.tasks)
