# Xunlei Downloader Backend

FastAPI RESTful API wrapping the reverse-engineered Xunlei Pan protocol, with a SQLite
store for runtime settings, credentials and the server-side transfer queue.

```bash
uv sync --locked
cp .env.example .env.development   # already prepared on this machine
uv run uvicorn app.main:app --host 127.0.0.1 --port 8011 --workers 1
```

Interactive API contracts: `/docs` (Swagger) and `/redoc`. Keep a single worker: the
transfer queue and login sessions live in the process.

When `FRONTEND_DIST` (default `../frontend/dist`) contains a build, the API also serves the
single-page app with history fallback, so production needs only this process.

Validate with `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, and
`uv run pytest`. Tests use temporary data directories and never contact Xunlei.
