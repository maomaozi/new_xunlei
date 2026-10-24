# Backend Rules

- Follow the root rules. Use typed Python 3.12+, FastAPI, Pydantic v2 and uv. Use only this directory's `.venv` binaries and uv; do not use pip, Poetry, Pipenv or Conda for project dependency management.
- Layers: routers in `app/api/v1` handle request/response only; Xunlei protocol code lives in `app/services/xunlei` (`http.py` transport, `api.py` endpoints, `gcid.py`, `torrent.py`, `oss.py`); the transfer queue in `app/services/transfers.py`; persistence in `app/repositories`; SQLite infrastructure in `app/db`; schemas in `app/schemas`.
- Remote payloads are parsed into the typed models in `app/schemas/xunlei.py` (unknown fields ignored, int64 strings normalized). Raw `JsonObject` stays inside `app/services/xunlei`.
- All Xunlei HTTP goes through `send_with_retry` / `XunleiApi.pan` so host pinning, IPv4, retries and token refresh apply. Bulk CDN/OSS traffic uses `XunleiApi.transfer_http` (no keep-alive).
- Never block the event loop: file I/O, hashing and directory scans go through `asyncio.to_thread`.
- Use structured errors (`AppError`) with stable English codes and Simplified Chinese messages; Xunlei's own `error_description` may be surfaced as the message. Log diagnostics in English; never return stack traces or tokens.
- Use logger rather than print and complete type hints.
- Document new endpoints, schemas, access (`Access: Public.`) and error responses in OpenAPI in the same change.
- Add meaningful tests with temporary data directories; never contact Xunlei from tests.
- Validate with `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, and `uv run pytest`.
