# Runner integration acceptance

## Agreed scope

The application uses one Runner task channel. Create link/torrent/cloud-file tasks through the Runner loopback proxy; preserve folder selection, BT file indexes, retry behavior and ambiguous-create recovery. This proxy still depends on the cloud. Retain the existing local debug snapshot for per-second progress and speed.

Expose a consistent task view across list, detail, summary, live refresh and operation feedback. Merge local persisted tasks, current memory observations, application history and optional cloud enrichment before filtering. Never require a cloud lookup for a genuinely local action or interpret an empty/failed source as an empty inventory. Never equate absence from the running snapshot with completion/deletion.

Use supported local task controls with reliable TaskId/DLTaskId mapping and observed outcomes. Detect platform limitations; preserve existing usable controls rather than advertise unsupported offline behavior. Do not integrate InnerWeb or add unrelated VFS/media features in this change.

## Ownership and constraints

- Implementation and first-line E2E: user-requested GPT-6.1-sol, high reasoning, one subagent without further delegation.
- Independent acceptance: parent agent reviews code, checks actual protocol behavior and validates the finished application.
- Both repositories remain on `main`. Preserve pre-existing modifications to the app README/architecture and its untracked service installer.
- No app records belong in root `progress.md`. No deployment, push, shared-token experiments or restarting the user's active engines.
- User-facing changes retain the existing neumorphic/frosted-glass components, phone action sheets and light/dark themes. Show concise operational feedback, not protocol explanations or decorative copy.

## Acceptance checklist

- [x] List/detail/summary stay consistent after local transitions and with stale cloud records.
- [x] Local inventory and historical details remain available during cloud failure or engine shutdown.
- [x] Instance/account changes cannot reuse another instance's task mappings or operation results.
- [x] Touch `{}` or HTTP 200 alone cannot confirm pause, resume or deletion.
- [x] Supported control paths preserve user-visible pause/resume/delete on the configured platform.
- [x] Timeout budgets include HTTP time; mixed batch outcomes are accurately reported.
- [x] Queued resume is distinct from transferring; pending feedback does not fabricate observed state.
- [x] Local task creation preserves folders and BT selections and avoids duplicate creation on a lost response.
- [x] Delete records and disk cleanup are distinct; only the selected task's owned paths are removed.
- [x] Runtime controls and their defaults are reflected in the database settings and settings page.
- [x] Backend lint/format/types/tests and frontend lint/tests/build pass.
- [x] Reproducible app/API E2E and browser interaction tests pass; simulated and native-engine results are identified separately.
- [x] Desktop and 390px phone in light/dark themes preserve layout, readable status and usable task actions.

## Independent protocol observations

Read-only probes found the active app Runner on port 5075 uses the Synology platform. Its `/device/debug` works, but `/device/status`, `/device/v1/local_config` and `/device/v1/touch_dltask` return HTTP 404. The separate QNAP Runner on 5055 returns HTTP 200 `{}` for a deliberately nonexistent touch task. Platform capability and state confirmation are therefore required, not optional enhancements.

The implementation agent's new read-only database reader successfully parsed both real databases using explicit `info.file` identities: 10 tasks/42 files for the QNAP instance and 28 tasks/900 files for the Synology instance at the time of observation. These counts are sample evidence, not an expected invariant. The debug snapshot's DeviceId/DeviceSpace fields were empty in this environment; they must not be the only identity source.

The review and verification results below describe the implemented scope and its native-engine limits.

### Native Runner control probe

A dedicated task with a unique `codex-runner-…` filename was created through the QNAP loopback `POST /drive/v1/task`, using a temporary throttled HTTP source on localhost. It appeared immediately in the debug snapshot. It remained pending and had no persisted DLTaskId during a 12-second observation window; no existing task or concurrency setting was changed.

A second dedicated task verified the working queued-task control path: local proxy `PATCH /drive/v1/task` with `spec.phase=pause` returned HTTP 200 and the debug phase became `PHASE_TYPE_PAUSED` within the first one-second observation. The state remained paused over subsequent observations. `spec.phase=running` returned the task to `PHASE_TYPE_PENDING`, correctly indicating resumed scheduling rather than active data transfer.

Cloud deletion requests for the dedicated tasks succeeded, and no matching owned files remained in the test instance download directory. The temporary source servers exited with their probe processes. This validates proxy creation and queued-task pause/resume. It does **not** establish successful data transfer or pure touch control of a running task. Tests must retain that distinction.

Follow-up cleanup verification found a native-engine limitation: the dedicated records return cloud HTTP 404 but remain queued in `Process`, absent from `Running` and without a LocalTaskInfo mapping. A third controlled creation on the Synology instance behaved the same way. Repeating deletion without `space`, or empirically trying touch on the two owned QNAP TaskIds, did not remove those entries. No existing task was touched, source servers are stopped, and no sample files remain, but in-memory cleanup is **not confirmed**. The implementation must report this accurately and cannot safely assume that proxy DELETE 200 means native removal. Existing engines were not restarted to conceal the result.

During code review the initial database adapter was found to recursively select the first matching task bucket regardless of user. The implementation agent was asked to replace this with exact user-scoped bucket navigation and multi-user tests before acceptance.


## Final acceptance results

The parent independently reviewed the backend merge/control/persistence code and the frontend
cache behavior. Review fixes included exact account bucket selection, the nested file bucket,
retryable partial cleanup, business errors carried inside HTTP 200, nonblocking shared reads
while a control HTTP request is pending, account checks before mutation, late state confirmation,
cloud-only history updates without losing paths, current memory errors/paths, and epoch-aware
cache handling after a backend restart or instance switch.

- Backend: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`,
  `uv run pytest` passed; **61 tests**. The new coverage includes an encrypted synthetic
  Bolt/Gob fixture with two accounts and conflicting metadata pages, rejected wrong keys,
  shared API list/detail/live observations, real local JWT/client transport, control deadlines,
  queued resume, mixed batch outcomes, delayed confirmations, partial multi-file cleanup,
  cloud unavailability, ambiguous response recovery and account/service changes.
- Frontend: Bun lint, all **23 unit tests**, TypeScript compilation and Vite production build
  passed. The browser driver is packaged with a pinned Playwright development dependency.
- Browser: **8 scenarios passed** through the real built frontend and FastAPI application,
  with deterministic fake Runner/cloud transports. Desktop light/dark and 390px phone
  light/dark cover pending feedback, pause/resume, filters/counts, details, creation and
  mobile action sheets/long-press selection. Separate cases cover partial deletion, timeout,
  database degradation and a new epoch with version reset. Browser assertions check console
  errors, horizontal overflow and unified query usage.
- Native read-only service check: with cloud enrichment forcibly unavailable, the production
  reader/client/shared service returned **13 tasks and 42 file records in about 72 ms** from
  the QNAP instance. List/detail/live shared a version. Simulating process unavailability in
  the isolated service kept all 13 history rows, zeroed speeds and disabled controls. This
  changed no actual engine process, settings or workload; the isolated app database was removed.
- Visual review: the parent inspected desktop dark and phone light/dark screenshots. Existing
  layout, shadows, accent colors, cards, bottom navigation and phone interaction patterns remain.
  Added copy is limited to operational progress, unavailable data and actionable failures.
- Root `progress.md` remains unchanged. Both repositories remain on `main`. Existing README,
  architecture additions and the service installer were preserved; architecture wording was
  updated to reflect the final implemented behavior. No deployment, push or commit was made.

Browser evidence can be regenerated with the commands in `runner-integration.md`.
The captured run is at `/tmp/xunlei-runner-browser-e2e/results.json`, with screenshots alongside it.
This directory contains only synthetic test data, not account credentials.
The isolated browser test server on port 8019 has stopped. The user's existing application
and native engines were not restarted or deployed as part of acceptance.

## Acceptance boundary

Application behavior and isolated end-to-end scenarios pass. Native proxy creation and queued
pause/resume have been observed. The native environment did not start sample byte transfer or
provide a mapped sample suitable for pure touch validation. Native deletion can retain queued
memory entries after successful cloud removal; the implementation returns an unconfirmed result
and preserves disk contents in that case. These are explicit limitations, not successful native
transfer/deletion tests. The three dedicated native probe records have no remaining cloud records
or matching downloaded files, but their in-memory removal was not confirmed; existing engines
were deliberately not restarted to hide that result.
