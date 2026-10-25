"""Application-owned Runner history; never writes the engine's Bolt database."""

import json
from dataclasses import dataclass

from app.db.connection import Database
from app.schemas.engine import DownloadOperation, DownloadTask


@dataclass
class SavedTask:
    task: DownloadTask
    dl_task_id: str
    paths: list[str]
    deleted: bool
    operation: DownloadOperation | None
    retired_record: str = ""


class RunnerTaskRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def load(self, instance: str) -> dict[str, SavedTask]:
        result: dict[str, SavedTask] = {}
        for row in self.db.fetchall("SELECT * FROM runner_tasks WHERE instance = ?", (instance,)):
            raw = json.loads(str(row["operation"]))
            operation = DownloadOperation.model_validate(raw) if raw else None
            task = DownloadTask.model_validate_json(str(row["payload"]))
            if operation and operation.status == "pending":
                # A process interruption is an unknown outcome, never a successful action.
                operation = operation.model_copy(update={"status": "submitted"})
            result[task.id] = SavedTask(
                task,
                str(row["dl_task_id"]),
                json.loads(str(row["paths"])),
                bool(row["deleted"]),
                operation,
                str(row["retired_record"]),
            )
        return result

    def save(self, instance: str, saved: SavedTask) -> None:
        self.db.execute(
            "INSERT INTO runner_tasks "
            "(instance, task_id, payload, dl_task_id, paths, deleted, operation, retired_record) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(instance, task_id) DO UPDATE SET "
            "payload=excluded.payload, dl_task_id=excluded.dl_task_id, paths=excluded.paths, "
            "deleted=excluded.deleted, operation=excluded.operation, "
            "retired_record=excluded.retired_record",
            (
                instance,
                saved.task.id,
                saved.task.model_dump_json(),
                saved.dl_task_id,
                json.dumps(saved.paths),
                int(saved.deleted),
                saved.operation.model_dump_json() if saved.operation else "{}",
                saved.retired_record,
            ),
        )

    def save_many(self, instance: str, rows: list[SavedTask]) -> None:
        with self.db.transaction():
            for saved in rows:
                self.save(instance, saved)
