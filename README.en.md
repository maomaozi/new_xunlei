# Xunlei Downloader

[简体中文](README.md) | **English**

A self-hosted web app for Xunlei Pan and download management. Browse and manage your Xunlei cloud drive from your own Linux host, and use the bundled Xunlei download engine to fetch links, magnets, torrents and cloud files straight to local disk. The desktop layout uses a sidebar; on phones it switches to a native-style bottom tab bar with action sheets, long-press multi-select and bottom sheets. It supports light and dark themes and can be installed as a PWA on the desktop or home screen.

> The site has no login of its own; it only uses your Xunlei account. Anyone who can reach the site can act on the signed-in Xunlei account, so run it on a trusted LAN only.

## Screenshots

<p align="center">
  <img src="docs/images/desktop-overview.png" alt="Desktop overview" width="49%">
  <img src="docs/images/desktop-settings.png" alt="Desktop settings" width="49%">
</p>

<p align="center">
  <img src="docs/images/mobile-overview.png" alt="Mobile home page" width="32%">
  <img src="docs/images/mobile-downloads.png" alt="Mobile downloads page" width="32%">
</p>

## Features

### Cloud drive

- Browse folders with virtual scrolling and infinite loading, in list or grid view, with sorting by name, modified time, created time or size
- Category views: video, images, audio, documents, archives, favorites
- File operations: create folder, rename, move, copy, favorite; delete to the trash or permanently
- File details: size, GCID, direct link, resolution and more
- Online playback, external player, copy direct link, download through the browser

### Upload

- Upload files or whole folders from the browser, keeping the directory structure
- Upload files or directories that live on the server
- Instant upload first, direct upload otherwise, with large files split into parts and uploaded concurrently
- Name conflicts can be auto-renamed, overwritten or skipped

### Download

- Magnet, HTTP(S), FTP, ed2k and thunder links plus `.torrent` files, downloaded to the local machine
- Multi-connection segmented downloads with BT, P2SP and member acceleration; acceleration channels are shown
- Pick which files to download from a torrent or magnet, and choose the save folder
- Pause, resume, retry and delete tasks, optionally removing the downloaded files too
- Fetch files and folders from the cloud drive straight to the local machine
- Live progress and speed, plus a one-click reset of the super-acceleration trial
- A built-in HTTP downloader is also available: segmented multi-connection downloads from the drive with resume, a global speed limit, name-conflict policy, and automatic link switching when a node fails

### Cloud add (offline download)

- Submit magnet, HTTP(S), FTP and ed2k links to the cloud in bulk
- `.torrent` files are parsed and previewed before submitting, with selectable sub-files
- Choose the save location; task progress refreshes automatically; tasks can be deleted, optionally with their files

### Download engine

- Starts with the service and is supervised, recovering automatically after a crash
- Sign in once with a QR code; the cloud drive and downloads share the same account and the session renews itself
- Inspect engine status, download folder, disk usage and logs, and detect conflicting processes
- Switch the runtime platform in settings; the engine restarts after saving

### Shares

- Create shares with an expiry, an access code and a save-count limit
- List shares with view and save statistics, copy links, cancel shares

### Trash and activity

- Trash: restore, delete permanently, empty
- Activity: a timeline of changes in your drive

### Account and overview

- Xunlei QR-code sign-in, sign-out and account switching
- The overview page shows membership level, storage usage, recent cloud-add tasks and activity, and shortcuts to common actions

### Settings

Everything can be changed in the web UI and takes effect immediately:

| Category | Contents |
|---|---|
| Account | Sign-in state, sign-out and switching accounts |
| Download engine | Download folder, speed limits, concurrency, process and runtime environment |
| Drive downloads | Download method (engine / built-in downloader), name-conflict policy |
| Upload | Instant upload, part size, concurrency |
| Cloud add | Default save location, refresh interval |
| Drive | Default view, sorting, delete mode |
| Shares | Default expiry and access code |
| Playback | External player, autoplay |
| Appearance | Theme, accent color, density, animation |
| Network | Proxy, timeouts, retries, direct IP for domains, user agent |
| System | Which local folders the app may access |

## Requirements

- A Linux host (an arm64 download engine is bundled; see "Download engine" below for other architectures)
- [uv](https://docs.astral.sh/uv/) (Python 3.12+ backend)
- [Bun](https://bun.sh/) (frontend)
- Bash 4.3+ to run the start scripts

## Quick start

```bash
git clone git@github.com:maomaozi/new_xunlei.git
cd new_xunlei

./start.sh --prod   # build the frontend and serve everything: http://127.0.0.1:8011
./start.sh          # development: frontend http://127.0.0.1:5176, API docs http://127.0.0.1:8011/docs
```

The script installs dependencies and, on first run, creates `.env.development` from `.env.example`. To reach it from another device on your LAN, replace the address with the host's IP.

After opening the page, sign in with the Xunlei app by scanning the QR code under "Settings → Account" or on the "Download engine" page. The cloud drive and downloads share that one account.

### Start backend and frontend separately

```bash
cd backend && uv sync --locked && uv run uvicorn app.main:app --host 0.0.0.0 --port 8011
cd frontend && bun install --frozen-lockfile && bun --bun run dev
```

### Start at boot (systemd user service)

```bash
./install-service.sh
```

The script builds the frontend, installs the `xunlei-web.service` user service, enables linger so it starts at boot, and listens on `0.0.0.0:8011`.

```bash
systemctl --user status xunlei-web.service
journalctl --user -u xunlei-web.service -f
```

## Download engine

On startup the backend launches and supervises the Xunlei download engine in `engine/`. Its runtime data lives in `backend/data/engine`, and its status is shown on the "Download engine" page.

- A linux/arm64 build is bundled. For other architectures, put the matching engine binary in place as described in [engine/README.md](engine/README.md), or point to it under "Settings → Download engine → Engine program path"
- Only one engine can be online per device ID, so stop any other NAS edition of Xunlei before using this app
- "Settings → Download engine → Process and runtime environment" lets you choose the platform (QNAP, Synology, generic, Linux); the engine restarts after saving
- Signing out affects both the drive and downloads; while the engine is stopped or the session has expired, drive features are unavailable until you sign in again

## Configuration and data

- Runtime behavior is changed on the Settings page, stored in the database, and applied immediately
- Process-level options (data directory, CORS, log level, whether to autostart the engine, etc.) live in `backend/.env.development`; see `backend/.env.example`
- All runtime data is under `backend/data/` (git-ignored):
  - `xunlei_web.sqlite3`: settings, account and transfer tasks
  - `uploads/`: staging area for browser uploads
  - `engine/`: runtime data of the download engine

## Tech stack

- Backend: Python 3.12+, FastAPI, Pydantic v2, httpx, SQLite, managed with uv
- Frontend: React, TypeScript, Vite, React Router, Ant Design, Tailwind CSS v4, TanStack Query, managed with Bun

## Layout

```text
backend/            FastAPI backend
frontend/           React single-page app
engine/             bundled Xunlei download engine (linux/arm64)
docs/               documentation
start.sh            one-command start (development / --prod)
install-service.sh  install the systemd user service
```

## Development and checks

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
cd frontend && bun --bun run lint && bun --bun run test && bun --bun run build
```
