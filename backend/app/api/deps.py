from typing import Annotated, cast

from fastapi import Depends, Request

from app.services.container import Container
from app.services.engine.service import EngineService
from app.services.settings_store import SettingsStore
from app.services.transfers import TransferManager
from app.services.xunlei.api import XunleiApi


def get_container(request: Request) -> Container:
    return cast(Container, request.app.state.container)


def get_api(request: Request) -> XunleiApi:
    return get_container(request).api


def get_settings_store(request: Request) -> SettingsStore:
    return get_container(request).settings


def get_transfers(request: Request) -> TransferManager:
    return get_container(request).transfers


def get_engine(request: Request) -> EngineService:
    return get_container(request).engine


ApiDep = Annotated[XunleiApi, Depends(get_api)]
SettingsDep = Annotated[SettingsStore, Depends(get_settings_store)]
TransfersDep = Annotated[TransferManager, Depends(get_transfers)]
EngineDep = Annotated[EngineService, Depends(get_engine)]
