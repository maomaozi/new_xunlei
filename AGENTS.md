# Project Rules

- Work on `main`. Subagents must not launch further subagents; use subagents only when explicitly requested or necessary for complex work. Do not use subagents in plan mode.
- Load skills only when explicitly requested. Read focused file sections rather than large files.
- The parent project's `progress.md` is exclusively for reverse-engineering findings and TODOs. Never write application development, frontend/backend fixes, test/build results, commits/pushes, deployments or service operations there; keep application notes in this project's relevant documentation.
- The product is a single-user web app for the Xunlei Pan account stored on this host: cloud drive browsing and file operations, trash, shares, activity, cloud add (offline download), downloads executed by the bundled Xunlei engine (`engine/`, `app/services/engine`), and server-side uploads / HTTP downloads. See `docs/architecture.md` for the reverse-engineered protocol.
- The site has no authentication of its own by design; only Xunlei login (QR / password / credential import) exists. Do not add site accounts, roles or tokens without a product request, and do not expose the API publicly by default.
- Keep changes simple and cohesive. Use English for identifiers, filenames, routes, comments, logs, and technical documentation; use Simplified Chinese for user-facing UI and error messages.
- Frontend: React, TypeScript, Vite, React Router, Ant Design, Tailwind CSS v4, TanStack Query, lucide-react and react-virtuoso. Use Bun exclusively.
- Backend: Python 3.12+, FastAPI, Pydantic v2, httpx, uv. Use `backend/.venv` and uv for Python operations.
- Use frontend/backend `AGENTS.md` for their specific conventions.
- Every runtime-tunable behavior belongs in the database-backed `AppSettings` and must be editable on the settings page in the same change. Process-level settings (data dir, CORS, log level) stay in `.env`.
- Run checks appropriate to the change. Test meaningful behavior; do not add tests for static markup or CSS classes. Tests must never call real Xunlei endpoints.
- Keep credentials, the SQLite database, upload temp files and downloaded content out of Git (`backend/data/`).
- Live verification against the real account must use dedicated, clearly named test folders and clean them up. Never empty the trash, delete user files or cancel user tasks that the test did not create.
- Do not push, publish, or deploy unless the user asks.
- Maintain `.env.example`, lockfiles, and setup documentation when dependencies or settings change.
- Preserve existing data and API compatibility when features are added. Schema changes are append-only migrations in `backend/app/db/migrations.py`; never reset the database at startup.
