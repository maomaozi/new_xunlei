import json
from datetime import UTC, datetime

from app.db.connection import Database

APP_SETTINGS_KEY = "app"


class SettingsRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def load(self) -> dict[str, object] | None:
        row = self.db.fetchone("SELECT value FROM settings WHERE key = ?", (APP_SETTINGS_KEY,))
        if row is None:
            return None
        value = json.loads(str(row["value"]))
        return value if isinstance(value, dict) else None

    def save(self, value: dict[str, object]) -> None:
        self.db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value,"
            " updated_at = excluded.updated_at",
            (APP_SETTINGS_KEY, json.dumps(value, ensure_ascii=False), _now()),
        )


def _now() -> str:
    return datetime.now(UTC).isoformat()
