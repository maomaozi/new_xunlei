from fastapi import APIRouter, Query

from app.api.deps import EngineDep
from app.api.responses import ENGINE_ERRORS
from app.schemas.common import OkResponse
from app.schemas.engine import EngineCapabilities
from app.schemas.engine_extensions import (
    RemoteTaskAction,
    RemoteTaskCreate,
    RemoteTaskResult,
    StorageCreate,
    StorageList,
    StorageTypes,
    StorageUpdate,
)
from app.schemas.settings import EnginePlatform
from app.schemas.xunlei import DriveTask, TaskList

router = APIRouter(prefix="/engine", tags=["engine"], responses=ENGINE_ERRORS)


@router.get(
    "/capabilities",
    response_model=EngineCapabilities,
    summary="Platform capabilities",
    description="Platform defaults narrowed by observed local route availability. Access: Public.",
)
async def capabilities(
    engine: EngineDep, platform: EnginePlatform | None = None
) -> EngineCapabilities:
    return engine.capabilities(platform)


@router.get(
    "/storage/types",
    response_model=StorageTypes,
    summary="Storage form templates",
    description="Native supported storage types and configuration fields. Access: Public.",
)
async def storage_types(engine: EngineDep) -> StorageTypes:
    return await engine.extensions.storage_types()


@router.get(
    "/storage",
    response_model=StorageList,
    summary="List storage mounts",
    description="Native VFS mounts with credential values omitted. Access: Public.",
)
async def storage_list(
    engine: EngineDep, page_token: str = Query(default="", max_length=2048)
) -> StorageList:
    return await engine.extensions.storage_list(page_token)


@router.post(
    "/storage",
    response_model=OkResponse,
    summary="Connect storage",
    description="Create a native mount using fields from its type template. Access: Public.",
)
async def storage_create(engine: EngineDep, body: StorageCreate) -> OkResponse:
    await engine.extensions.storage_create(body)
    return OkResponse()


@router.put(
    "/storage/{mount_id}",
    response_model=OkResponse,
    summary="Update storage",
    description="Update a native mount; blank credentials retain saved values. Access: Public.",
)
async def storage_update(mount_id: str, engine: EngineDep, body: StorageUpdate) -> OkResponse:
    await engine.extensions.storage_update(mount_id, body.config)
    return OkResponse()


@router.delete(
    "/storage/{mount_id}",
    response_model=OkResponse,
    summary="Disconnect storage",
    description="Unmount storage without deleting its files. Access: Public.",
)
async def storage_remove(mount_id: str, engine: EngineDep) -> OkResponse:
    await engine.extensions.storage_remove(mount_id)
    return OkResponse()


@router.get(
    "/devices/{device_id}/tasks",
    response_model=TaskList,
    summary="Remote downloads",
    description="List a configured device's tasks through the native remote proxy. Access: Public.",
)
async def remote_tasks(
    device_id: str,
    engine: EngineDep,
    page_token: str = Query(default="", max_length=2048),
) -> TaskList:
    return await engine.extensions.remote_tasks(device_id, page_token)


@router.post(
    "/devices/{device_id}/tasks",
    response_model=DriveTask,
    summary="Create remote download",
    description="Submit once to the selected device's namespace. Access: Public.",
)
async def remote_create(device_id: str, engine: EngineDep, body: RemoteTaskCreate) -> DriveTask:
    return await engine.extensions.remote_create(device_id, body)


@router.post(
    "/devices/{device_id}/tasks/{task_id}",
    response_model=RemoteTaskResult,
    summary="Control remote download",
    description=(
        "Control a remote task and observe confirmation. No local file deletion. Access: Public."
    ),
)
async def remote_action(
    device_id: str,
    task_id: str,
    engine: EngineDep,
    body: RemoteTaskAction,
) -> RemoteTaskResult:
    return await engine.extensions.remote_action(device_id, task_id, body.action)
