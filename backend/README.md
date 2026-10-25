# Xunlei Downloader Backend

FastAPI RESTful API wrapping the reverse-engineered Xunlei Pan protocol, with a SQLite
store for runtime settings, account metadata and the server-side transfer queue.

```bash
uv sync --locked
cp .env.example .env.development   # already prepared on this machine
uv run uvicorn app.main:app --host 127.0.0.1 --port 8011 --workers 1
```

Interactive API contracts: `/docs` (Swagger) and `/redoc`. Keep a single worker: the
transfer queue and engine supervisor live in the process.

When `FRONTEND_DIST` (default `../frontend/dist`) contains a build, the API also serves the
single-page app with history fallback, so production needs only this process.

Validate with `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, and
`uv run pytest`. Tests use temporary data directories and never contact Xunlei.

Authentication uses the bundled engine only. Scan its QR code under
`/api/v1/engine/login/qrcode`; poll `/api/v1/engine/login/status`. The backend reads the
engine's active access token on loopback and never exchanges a refresh token. Account
status is available at `GET /api/v1/account`; `POST /api/v1/account/refresh` synchronizes
it, and `POST /api/v1/account/logout` signs out the shared engine session. These routes
have public access, like all other application routes. Status returns `logged_in=false`
when the engine is unavailable; authenticated operations return structured 401/503 errors.
Independent login, credential import and device editing routes have been removed.
