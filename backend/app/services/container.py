from dataclasses import dataclass

from app.core.config import Settings
from app.db.connection import Database
from app.db.migrations import apply_migrations
from app.repositories.account import AccountRepository
from app.repositories.settings import SettingsRepository
from app.repositories.transfers import TransfersRepository
from app.services.engine.service import EngineService
from app.services.settings_store import SettingsStore
from app.services.transfers import TransferManager
from app.services.xunlei.api import XunleiApi


@dataclass
class Container:
    db: Database
    settings: SettingsStore
    api: XunleiApi
    transfers: TransferManager
    engine: EngineService

    @classmethod
    def create(cls, process_settings: Settings) -> "Container":
        db = Database(process_settings.database_path)
        apply_migrations(db)
        settings = SettingsStore(SettingsRepository(db))
        api = XunleiApi(settings, AccountRepository(db))
        transfers = TransferManager(
            TransfersRepository(db), api, process_settings.resolved_data_dir
        )
        settings.subscribe(transfers.on_settings_changed)
        engine = EngineService(
            settings,
            api,
            process_settings.resolved_data_dir,
            autostart=process_settings.engine_autostart,
        )
        return cls(db=db, settings=settings, api=api, transfers=transfers, engine=engine)

    async def start(self) -> None:
        self.transfers.start()
        await self.engine.start_service()

    async def stop(self) -> None:
        await self.engine.stop_service()
        await self.transfers.stop()
        await self.api.close()
        self.db.close()
