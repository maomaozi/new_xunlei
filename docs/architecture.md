# Architecture

## Overview

```text
Browser (React SPA, PWA)  ──/api/v1──▶  FastAPI (single worker)
                                         ├─ XunleiApi (httpx, async)  ──▶ xluser-ssl.xunlei.com (auth)
                                         │                            ──▶ api-pan.xunlei.com (drive, pinned IP)
                                         ├─ TransferManager           ──▶ VIP CDN (Range downloads)
                                         │                            ──▶ Aliyun OSS (STS uploads)
                                         └─ SQLite (settings, account, transfers)
```

The backend talks to the Xunlei API directly (typed async client) and supervises the official
`xunlei-pan-cli` engine for downloads; endpoints and payloads were verified against the live
API on 2026-10-23/24.

## Xunlei protocol used

| Feature | Endpoint |
|---|---|
| QR login | `POST /v1/auth/device/code`, poll `POST /v1/auth/token` (device_code grant) |
| Password login | `POST /v1/shield/captcha/init` → `POST /v1/auth/signin?captcha_token=` |
| Refresh | `POST /v1/auth/token` (refresh_token grant) |
| Profile / VIP | `GET /v1/user/me` (auth host) |
| Quota | `GET /drive/v1/about` |
| List | `GET /drive/v1/files` with `filters` (`trashed`, `starred`, `mime_type.prefix`, `category`); `parent_id=*` searches all folders |
| Details / link | `GET /drive/v1/files/{id}` → `web_content_link`, `links` |
| Folder / rename | `POST /drive/v1/files` (drive#folder), `PATCH /drive/v1/files/{id}` |
| Batch | `POST /drive/v1/files:batchMove|batchCopy|batchTrash|batchUntrash|batchDelete`, `files:star|unstar` |
| Empty trash | `PATCH /drive/v1/files/trash:empty` (PikPak-compatible, not live-tested) |
| Upload | `POST /drive/v1/files` (`UPLOAD_TYPE_RESUMABLE`, GCID) → `PHASE_TYPE_COMPLETE` = instant, else `resumable.params` STS → OSS PUT / multipart |
| Cloud add | `POST /drive/v1/files` (`UPLOAD_TYPE_URL`; BT sub-files via `url.files: ["0","2"]`), list `GET /drive/v1/tasks?type=offline`, delete `DELETE /drive/v1/tasks?task_ids=&delete_files=` |
| Engine download | `POST /drive/v1/task` (`user#download-url` link / `user#download` cloud file, space and `params.target` = `device_id#<id>`, `sub_file_index: "0-2,5"`, `parent_folder_id` = engine folder); pause/resume `PATCH /drive/v1/task` `set_params.spec = {"phase":"pause"\|"running"}`; list/delete with `space` |
| Link sub-files | `POST /v1/shield/captcha/init` (action `POST:/drive/v1/resource/list`, `meta.captcha_sign` = 10-round salted MD5, token cached ~300 s) → `POST /drive/v1/resource/list` with `X-Captcha-Token`; leaf `file_index` is the BT file index |
| Shares | `POST /drive/v1/share` (`restore_limit: "-1"` is required for unlimited restores), `GET /drive/v1/share/list`, `POST /drive/v1/share:batchDelete` |
| Events | `GET /drive/v1/events` |

## Networking

- `custom_host_to_ip` pinning: the URL host is replaced with the IP while `Host` and the
  TLS SNI/verification name (`sni_hostname` extension) stay on the original domain.
- IPv4-only sockets (`local_address=0.0.0.0`), bounded retries with exponential backoff.
  Non-idempotent requests are retried only when nothing reached the server.
- API calls share a pooled client; CDN downloads, OSS uploads and the stream proxy use a
  client without keep-alive because those nodes drop idle connections.
- CDN links are bound to the requesting public IP. `download.proxy_browser_downloads`
  streams browser downloads/playback through `/api/v1/files/{id}/stream` (Range aware).

## Transfers

- Rows live in the `transfers` table; in-memory runtime state (bytes, speed, segments) is
  flushed every second and on pause/stop, so downloads resume from their segments.
- Downloads: `<name>.xltd` pre-allocated file, N segments with `os.pwrite`, global token
  bucket rate limiter, link refresh on 403/410 and after repeated network errors, atomic
  rename on completion, conflict policy applied once.
- Uploads: GCID (cached per size+mtime) → create → instant or OSS (single PUT with retries,
  or multipart with per-part retries and abort on failure). A retry first checks the cloud
  entry of the previous attempt to avoid empty `PENDING` duplicates named `x(1)`.

## Download engine

```text
EngineService ──spawn──▶ engine/xunlei-pan-cli -q run runner   (HOME=data/engine, PLATFORM=qnap,
     │                     ALLOW_CUSTOM_PLATFORM=true, DriveListen=127.0.0.1:<control_port>)
     ├─ LauncherServer 127.0.0.1:<launcher_port>  ◀── engine asks /launcher/auth
     └─ EngineClient ──▶ engine loopback API (status, local_config, QR login, folders, trial)
cloud task (POST /drive/v1/task, target device_id#<id>) ──MQTT──▶ engine ──▶ xldownloadlib
```

- Process: `ALLOW_CUSTOM_PLATFORM` skips hardware detection; the watchdog restarts the engine
  with exponential backoff, adopts a running engine through `pan.pid`, restarts it when launch
  settings change and pushes runtime settings to `/device/local_config`. Other runners on the
  host are reported because one device id may only be online once (MQTT kick-out).
- Local auth: `.drive/26ebb6810d1737970457e6a91cdbd3d2` holds the JWT HMAC secret, AES-128-ECB
  with key `08e8a6fbfba6fbd6`. Local control routes take `LocalToken: LocalToken <jwt>` with
  claim `key=LocalToken`; the device API takes `pan-auth: <jwt>` with `key=UIAuth`, then calls
  `<LauncherAddress>/launcher/auth` and requires `{"key": StaticKey(token)}`
  (`utils.StaticKey`, see `app/services/engine/tokens.py`).
- Login: Xunlei rotates refresh tokens (the old one fails with `invalid_grant`), so the engine
  keeps its own chain via its QR login (`/auth/qrlogin`, `/auth/qrlogin/status`); it refreshes
  when less than 10% of `expires_in` is left. `/auth/credential` only exists on platforms
  labelled `withSetCredential`, which use other client ids.
- Live progress: the engine patches a running task's cloud copy at most every 60 s
  (`lastPatchTime more than 60s`), while its kernel loop refreshes progress/speed every second.
  `GET /device/debug?passwd=md5("asdfhjjkeunzmxll"+YYYYMMDD)` (LocalToken, loopback only,
  `utils.CheckDebugPasswd`) returns that in-memory state (`Process`, `Running`) in ~10 ms.
  The route answers 403 unless the engine logs at debug level (it starts at info), so the
  client calls `/device/debug/loglevel/debug?passwd=…` once and retries; debug level also
  starts Go pprof on control port + 2, and the watchdog copy-truncates the faster growing
  log. `GET /api/v1/downloads/live` serves it and the task list overlays it; the UI polls it every
  second and refetches the cloud list only when the set or status of live tasks changes.
- Tasks: progress, `speed`, `real_path`, `hash`, `error` and `speedup` (`p2p`/`vip`/`super`) are
  reported in the task params. Finished tasks keep their data on `delete_files=true`, so the
  backend removes `real_path` itself (only inside the engine download folders). A lost
  `POST /drive/v1/task` response is recovered by matching name + source within 5 minutes.

## Frontend

- `components/AppLayout.tsx`: desktop sidebar (collapsible, with a 新建 menu) / phone
  floating glass tab bar (下载 · 云盘 · + · 云添加 · 我的). The center + opens a create sheet;
  the dialogs it opens (new download, cloud add, browser upload) are global and exposed to
  pages through `lib/createContext.ts`. Secondary pages (传输, 引擎, 分享, 动态, 回收站, 设置)
  are reached from 我的 (`/`) on phones and show a back button in `PageHeader`.
  `UploadDock` shows the browser → server leg of uploads.
- Phone list pattern: tap a row for its action sheet (`BottomSheet`), long-press to enter
  multi-select; selection swaps the tab bar for an `ActionBar`. Ant Design modals render as
  bottom sheets on phones (CSS in `src/index.css`). A phone is a viewport under 768px or a
  small touch screen (`device-width` < 600px); the Tailwind breakpoints are redefined so a
  zoomed-out phone still gets the phone layout. `lib/viewport.ts` pins a phone's viewport
  meta to its screen width (so it is never laid out wider and shrunk) and disables pinch zoom.
- Server state via TanStack Query; polling intervals come from settings and speed up only
  while there is activity.
- Neumorphic design tokens plus frosted glass (`glass`, `glass-card`), the `hero-gradient`
  accent surface and tinted tiles (`tint`, `IconTile`) in `src/index.css`; `--accent-2` is a
  companion hue derived from the configured accent. Ant Design is themed in
  `components/ThemedApp.tsx` and rendered into the `antd` CSS layer.
