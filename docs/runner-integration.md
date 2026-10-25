# Runner integration implementation evidence

## 2026-10-25: source and protocol validation

The download lifecycle is being consolidated into one application snapshot. The Runner loopback proxy is the only creation channel. Local Bolt task records, per-file records and `/device/debug` are the primary query sources; cloud task listing is optional background enrichment.

The root demonstration client is a protocol reference only and is never imported. The production adapter uses `cryptography`, explicit instance/account identity, checksummed Bolt metadata, the actual transaction ID offset (48 bytes within metadata), inline buckets and Gob wire type descriptors. Reads run in worker threads and never write the engine database. Account isolation uses exact paths `<user>.taskinfo.db/LocalTaskInfo` and `<user>.files/files/LocalFile`.

The parent reviewer exercised the production reader against both existing Runner homes without changing their settings. Initial parsing recovered 10 tasks / 42 files on QNAP and 28 tasks / 900 files on Synology. Subsequent scoped-bucket validation identified the extra `files` hierarchy, now handled explicitly. All sampled existing task records omitted the zero-valued `DLTaskId`; `ResourceId` is not assumed to be a substitute.

Dedicated real protocol probes, run by the parent reviewer, established:

- Synology does not expose `/device/v1/touch_dltask` (HTTP 404).
- QNAP returns HTTP 200 `{}` for an unknown kernel ID; this cannot prove success.
- Loopback `POST /drive/v1/task` created a dedicated controlled HTTP task immediately in `Process`, initially queued and without a kernel mapping.
- Loopback `PATCH /drive/v1/task` with `spec.phase=pause` changed that task to `PHASE_TYPE_PAUSED` within one second; `running` returned it to `PHASE_TYPE_PENDING` within one second. Queued means runnable, not downloading.
- Only dedicated probe tasks were deleted. Existing workload, credentials and engine settings were preserved.

The supported policy therefore tries touch only with a trustworthy per-instance mapping and uses the configured Runner proxy fallback when needed. Proxy fallback remains dependent on the cloud. Per-item action results include transport and confirmation status; local `{}` acknowledgements are never treated as state transitions.

Implementation and application-level acceptance are complete. Backend lint, formatting, type checks and 61 tests pass; frontend and browser evidence follows below. Native-engine limitations remain explicitly documented. No production deployment, commit or push was performed.

## 2026-10-25: frontend and reproducible browser validation

The frontend now uses one TanStack Query key (`downloads`) for navigation, overview, filtered task lists and task details. Every transport request asks for the complete shared inventory; filtering happens after observation. Actions immediately mark affected rows pending, disable repeat controls, apply per-item confirmed/partial results to the shared inventory, recalculate counts and refresh. Details and phone action sheets follow the current shared row. Unsupported controls are disabled. The existing sidebar, mobile tab bar, BottomSheet, long-press ActionBar, neumorphism, frosted surfaces and accents are retained.

Observation ordering uses `(epoch, version)`: lower versions within the same epoch cannot roll back a newer query/action; a new epoch replaces an older cached snapshot after a backend restart or instance switch. An action response from a different epoch is ignored by the cache. The next authoritative query supplies the new instance's inventory. The UI gives brief Chinese messages for stale local/live sources and failed or partial operations; it adds no protocol choice or InnerWeb integration.

Frontend checks completed with Bun:

- `bun --bun run lint`: passed.
- `bun --bun run test`: 23 tests passed in 7 files. New cases cover action capability/pending behavior, mixed batch feedback, partial deletion retention, merged filtering/counts, local-only observations, stale response rejection and epoch changes.
- `bun --bun run build`: passed (TypeScript and Vite production build).

The browser harness in `backend/tests/browser_runner_app.py` runs the actual built frontend, FastAPI routes, production Runner service, local JWT/EngineClient transport and app SQLite history. Native engine/cloud requests use deterministic `FakeRunner` HTTP transport. It uses an automatically created temporary directory, does not launch an engine, and never contacts Xunlei. Test resets are serialized against snapshot collection and clear only its own temporary history. This is simulated E2E, separate from the parent's native Runner protocol probes.

The eight browser scenarios passed against a freshly restarted isolated API:

1. Desktop, light theme: pending pause, observed pause, queued resume, updated filters/counts, fresh details and local-proxy creation.
2. Desktop, dark theme: the same workflow.
3. 390px touch phone, light theme: pending pause/resume, fresh BottomSheet/details and a physical long press followed by ActionBar control.
4. 390px touch phone, dark theme: the same workflow.
5. Partial delete sync failure: the row and useful failure message remain visible.
6. Unconfirmed touch acknowledgement: timeout feedback, retained task and no success claim.
7. Unreadable persisted records with valid memory telemetry: useful live progress remains visible.
8. A newly constructed production observer with a different epoch and a lower version: the already open browser accepts and displays a newly added task.

The theme/viewport scenarios checked for horizontal overflow and browser runtime/API 5xx errors; none were found. Each screen used `/downloads?status=all` with no separate browser `/downloads/live` poll. The epoch scenario observed a real UUID change and a version decrease before checking the new row.

Artifacts for this run are `/tmp/xunlei-runner-browser-e2e/results.json` and screenshots in the same directory, including `desktop-light-initial.png`, `desktop-dark-initial.png`, `phone-390-light-initial.png`, `phone-390-dark-initial.png`, `partial_delete.png`, `timeout.png`, `degraded.png` and `new-epoch.png`. Temporary files are excluded from Git.

Reproduce from two terminals after installing project dependencies and building the frontend:

```bash
cd backend
uv run uvicorn tests.browser_runner_app:app --host 127.0.0.1 --port 8019 --no-access-log
```

```bash
cd frontend
bun --bun run test:e2e:runner
```

The frontend pins `playwright-core` as a dev dependency. Install its matching Chromium using `bunx playwright-core install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible Chromium. This host used `/home/maozi/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`. `RUNNER_E2E_URL` and `RUNNER_E2E_OUTPUT` optionally select the isolated server URL and artifact directory. Stop the test server after the run; its lifespan removes the temporary data directory.

## Native verification limitation

The parent reviewer confirmed that deleting the dedicated native task's cloud record can return HTTP 200 and subsequent cloud lookup HTTP 404 while its queued `Process` entry remains locally present. The implementation consequently does not equate successful proxy deletion with confirmed local removal: it reports an unconfirmed outcome and preserves files until fresh local sources prove the engine has stopped retaining the task. No actual native download or mapped pure-touch workflow was proven in the available live environment. The simulated E2E exercises those controlled state transitions reproducibly; it is not evidence of native throughput or offline-control support on Synology.
