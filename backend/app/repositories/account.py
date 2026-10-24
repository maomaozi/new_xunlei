from dataclasses import dataclass
from datetime import UTC, datetime

from app.db.connection import Database


@dataclass
class StoredCredentials:
    access_token: str = ""
    refresh_token: str = ""
    expires_at: float = 0
    user_id: str = ""
    device_id: str = ""
    source: str = ""
    updated_at: str = ""


class AccountRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def load(self) -> StoredCredentials:
        row = self.db.fetchone("SELECT * FROM account WHERE id = 1")
        if row is None:
            return StoredCredentials()
        return StoredCredentials(
            access_token=str(row["access_token"]),
            refresh_token=str(row["refresh_token"]),
            expires_at=float(row["expires_at"]),
            user_id=str(row["user_id"]),
            device_id=str(row["device_id"]),
            source=str(row["source"]),
            updated_at=str(row["updated_at"]),
        )

    def save(self, creds: StoredCredentials) -> StoredCredentials:
        creds.updated_at = datetime.now(UTC).isoformat()
        self.db.execute(
            "INSERT INTO account (id, access_token, refresh_token, expires_at, user_id, device_id,"
            " source, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET"
            " access_token = excluded.access_token, refresh_token = excluded.refresh_token,"
            " expires_at = excluded.expires_at, user_id = excluded.user_id,"
            " device_id = excluded.device_id, source = excluded.source,"
            " updated_at = excluded.updated_at",
            (
                creds.access_token,
                creds.refresh_token,
                creds.expires_at,
                creds.user_id,
                creds.device_id,
                creds.source,
                creds.updated_at,
            ),
        )
        return creds
