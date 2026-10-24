# Xunlei Downloader Frontend

React + TypeScript + Vite + Ant Design (zh-CN) + Tailwind CSS v4 + TanStack Query, with a
neumorphic design system (`src/index.css`, `src/components/ui.tsx`), light/dark themes,
responsive desktop/mobile layouts and a PWA manifest.

```bash
bun install --frozen-lockfile
bun --bun run dev        # http://127.0.0.1:5176, proxies /api, /docs, /redoc to :8011
```

Override the proxy target with `API_PROXY_TARGET` in `.env.development`.

```bash
bun --bun run lint
bun --bun run test
bun --bun run build
```
