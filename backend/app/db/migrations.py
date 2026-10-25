import logging

from app.db.connection import Database

logger = logging.getLogger(__name__)

# Append-only list of incremental schema steps. Never edit or reorder applied steps.
MIGRATIONS: list[str] = [
    """
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token TEXT NOT NULL DEFAULT '',
        refresh_token TEXT NOT NULL DEFAULT '',
        expires_at REAL NOT NULL DEFAULT 0,
        user_id TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
    );
    CREATE TABLE transfers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT NOT NULL,
        file_id TEXT NOT NULL DEFAULT '',
        parent_id TEXT NOT NULL DEFAULT '',
        local_path TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        done_bytes INTEGER NOT NULL DEFAULT 0,
        phase TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        group_id TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT '',
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX transfers_status_idx ON transfers (status);
    CREATE INDEX transfers_created_idx ON transfers (created_at);
    """,
    # Cloud-add "fetch" jobs were replaced by the Xunlei engine; their file downloads stay.
    """
    DELETE FROM transfers WHERE kind = 'fetch';
    """,
    """
    CREATE TABLE runner_tasks (
        instance TEXT NOT NULL,
        task_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        dl_task_id TEXT NOT NULL DEFAULT '',
        paths TEXT NOT NULL DEFAULT '[]',
        deleted INTEGER NOT NULL DEFAULT 0,
        operation TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (instance, task_id)
    );
    """,
]


def apply_migrations(db: Database) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    row = db.fetchone("SELECT version FROM schema_version")
    current = int(row["version"]) if row else 0
    if row is None:
        db.execute("INSERT INTO schema_version (version) VALUES (0)")
    for index in range(current, len(MIGRATIONS)):
        with db.transaction() as conn:
            for statement in MIGRATIONS[index].split(";"):
                if statement.strip():
                    conn.execute(statement)
            conn.execute("UPDATE schema_version SET version = ?", (index + 1,))
        logger.info("Applied database migration %d", index + 1)
