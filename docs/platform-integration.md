# Platform integration

The application uses the bundled 3.23.3 profiles and narrows capabilities when a local
route is absent. `GET /api/v1/engine/capabilities` returns the current profile; the optional
`platform` parameter previews another platform. Engine status includes the same capability
object. Platform privilege and protection-period presentation are outside this change.

| Capability | QNAP | Synology | Docker | Linux |
| --- | --- | --- | --- | --- |
| Launcher authentication | Yes | Yes | No | No |
| Detailed local status and runtime configuration | Yes | No | No | Yes |
| Native touch task controls | Yes | No | No | Yes |
| Storage mount management | Probe | Probe | Probe | Probe |
| Explicit device spaces, remote control, HTTP webhook delegation | No | No | No | Yes |

Startup, task creation and fallback controls only start the Launcher when required.
Launcher port conflicts are validated only on platforms that use that service. Settings
disable unavailable runtime controls, preserve their saved values, and offer a platform
switch action. The API rejects changes to unsupported controls instead of silently saving
ineffective values. The primary download directory remains editable because it is also
passed at process startup. No additional explanatory panels are added to the UI.

## Device spaces and remote downloads

Linux `engine.device_space` is empty for the existing default environment, or
`device_id#<id>` for an explicit environment. The settings form accepts the device ID.
Explicit spaces use `<engine home>/spaces/<space SHA-256 prefix>` and the matching
`DeviceId`/`DeviceSpace` environment variables. Switching spaces restarts the engine;
each space retains its own engine login and state. Returning to the default space uses
the original home. Existing account/task data is preserved.

`engine.remote_devices` stores named device IDs. The engine page provides a separate
remote task view and link submission, pause, resume and task deletion. Requests use the
native proxy with that device's `space` and task target. Remote results do not enter the
local task inventory, native database mappings, or disk cleanup. Only configured remote
devices can be controlled, and operations check task ownership and observe confirmation;
an accepted response alone is reported as submitted. Remote task and storage query caches
are separated by platform, engine home and account session.

## Storage and webhook configuration

The storage UI builds forms from native `/device/v1/vfs_types` templates. The API exposes
mount listing, creation, editing and removal through `/api/v1/engine/storage`. Only
advertised types and fields may be submitted. Responses omit credential values, blank
credentials in edits preserve the native saved values, and unmounting never invokes file
deletion. A missing collection/type route disables that capability for the current launch.
Mount management is distinct from the platform's automatic cloud-VFS placeholder feature;
QNAP exposes mount APIs even though its profile lacks the `withVFS` label.

Linux `engine.webhook_url` and `engine.webhook_modules` configure native HTTP function
delegation. The latter maps module names to method names. Startup serializes the verified
native format `module:method1,method2;module2:method URL`. The receiving service implements
the selected function contracts; this setting is not a download-event notification URL.
Configuration is database-backed and changes restart the engine.

## Validation

Backend tests use fake transports and temporary state to cover platform-specific startup,
namespace separation, capability-aware persistence, credential-preserving storage edits,
account changes and isolated remote controls, including unconfirmed HTTP success.

Frontend logic checks and the production build remain part of the normal checks. Browser
interaction checks use the isolated `tests.browser_runner_app` harness and deterministic
API responses; they cover desktop/light and 390px mobile/dark platform switching, disabled
controls, dynamic storage forms, blank password edits, remote targeting and overflow.
They do not claim live SMB/WebDAV server or remote-device interoperability.

```bash
cd backend
uv run uvicorn tests.browser_runner_app:app --host 127.0.0.1 --port 8019
# In another terminal:
cd frontend
bun --bun run build
bun --bun run test:e2e:platforms
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when the installed Chromium differs from the pinned
Playwright cache path. Screenshots are written under `/tmp/xunlei-platforms-e2e` by default.
