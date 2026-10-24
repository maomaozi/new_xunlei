import json
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.db.connection import Database

TransferKind = Literal["download", "upload"]
TransferStatus = Literal["queued", "running", "paused", "completed", "failed", "canceled"]
ACTIVE_STATUSES: tuple[TransferStatus, ...] = ("queued", "running", "paused")
FINISHED_STATUSES: tuple[TransferStatus, ...] = ("completed", "failed", "canceled")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class TransferRow:
    id: str
    kind: TransferKind
    status: TransferStatus
    name: str
    file_id: str = ""
    parent_id: str = ""
    local_path: str = ""
    size: int = 0
    done_bytes: int = 0
    phase: str = ""
    error: str = ""
    group_id: str = ""
    group_name: str = ""
    meta: dict[str, object] = field(default_factory=dict)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)
    finished_at: str = ""


UPDATABLE = frozenset(
    {
        "status",
        "name",
        "file_id",
        "parent_id",
        "local_path",
        "size",
        "done_bytes",
        "phase",
        "error",
        "meta",
        "finished_at",
    }
)


def _row(row: sqlite3.Row) -> TransferRow:
    meta = json.loads(str(row["meta"]) or "{}")
    return TransferRow(
        id=str(row["id"]),
        kind=row["kind"],
        status=row["status"],
        name=str(row["name"]),
        file_id=str(row["file_id"]),
        parent_id=str(row["parent_id"]),
        local_path=str(row["local_path"]),
        size=int(row["size"]),
        done_bytes=int(row["done_bytes"]),
        phase=str(row["phase"]),
        error=str(row["error"]),
        group_id=str(row["group_id"]),
        group_name=str(row["group_name"]),
        meta=meta if isinstance(meta, dict) else {},
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        finished_at=str(row["finished_at"]),
    )


class TransfersRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def insert_many(self, rows: list[TransferRow]) -> None:
        with self.db.transaction() as conn:
            conn.executemany(
                "INSERT INTO transfers (id, kind, status, name, file_id, parent_id, local_path,"
                " size, done_bytes, phase, error, group_id, group_name, meta, created_at,"
                " updated_at, finished_at) VALUES"
                f" ({', '.join('?' * 17)})",
                [
                    (
                        r.id,
                        r.kind,
                        r.status,
                        r.name,
                        r.file_id,
                        r.parent_id,
                        r.local_path,
                        r.size,
                        r.done_bytes,
                        r.phase,
                        r.error,
                        r.group_id,
                        r.group_name,
                        json.dumps(r.meta, ensure_ascii=False),
                        r.created_at,
                        r.updated_at,
                        r.finished_at,
                    )
                    for r in rows
                ],
            )

    def get(self, transfer_id: str) -> TransferRow | None:
        row = self.db.fetchone("SELECT * FROM transfers WHERE id = ?", (transfer_id,))
        return _row(row) if row else None

    def list_rows(
        self, *, kind: TransferKind | None = None, statuses: tuple[str, ...] | None = None
    ) -> list[TransferRow]:
        clauses: list[str] = []
        params: list[object] = []
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if statuses:
            clauses.append(f"status IN ({','.join('?' for _ in statuses)})")
            params.extend(statuses)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.db.fetchall(
            f"SELECT * FROM transfers {where} ORDER BY created_at DESC, rowid DESC", tuple(params)
        )
        return [_row(r) for r in rows]

    def list_group(self, group_id: str) -> list[TransferRow]:
        rows = self.db.fetchall(
            "SELECT * FROM transfers WHERE group_id = ? ORDER BY created_at, rowid", (group_id,)
        )
        return [_row(r) for r in rows]

    def next_queued(self, kind: TransferKind, exclude: set[str], limit: int) -> list[TransferRow]:
        rows = self.db.fetchall(
            "SELECT * FROM transfers WHERE kind = ? AND status = 'queued'"
            " ORDER BY created_at, rowid LIMIT ?",
            (kind, limit + len(exclude)),
        )
        return [r for r in (_row(x) for x in rows) if r.id not in exclude][:limit]

    def update(self, transfer_id: str, **fields: object) -> None:
        unknown = set(fields) - UPDATABLE
        if unknown:
            raise ValueError(f"unknown transfer fields: {unknown}")
        if "meta" in fields:
            fields["meta"] = json.dumps(fields["meta"], ensure_ascii=False)
        fields["updated_at"] = now_iso()
        assignments = ", ".join(f"{name} = ?" for name in fields)
        self.db.execute(
            f"UPDATE transfers SET {assignments} WHERE id = ?", (*fields.values(), transfer_id)
        )

    def set_status_where(self, old: tuple[str, ...], new: TransferStatus) -> None:
        self.db.execute(
            f"UPDATE transfers SET status = ?, updated_at = ? WHERE status IN"
            f" ({','.join('?' for _ in old)})",
            (new, now_iso(), *old),
        )

    def delete(self, ids: list[str]) -> None:
        if ids:
            self.db.execute(
                f"DELETE FROM transfers WHERE id IN ({','.join('?' for _ in ids)})", tuple(ids)
            )
