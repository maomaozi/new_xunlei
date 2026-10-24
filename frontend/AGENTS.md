# Frontend Rules

- Follow the root rules. Use React, Vite and TypeScript with strict type checking.
- Use Bun only; keep `bun.lock` current. On this host, use `bun --bun run <script>` to run tooling without installing Node separately.
- Use React Router for navigation, Ant Design with its Simplified Chinese locale for controls, Tailwind CSS v4 for layout and styling, TanStack Query for server state.
- Keep `@tailwindcss/vite` in Vite and `@import "tailwindcss"` in `src/index.css`. Ant Design styles are rendered into the `antd` CSS layer (`StyleProvider layer`), below Tailwind utilities; do not import `antd/dist/reset.css`.
- Visual language is neumorphism with frosted glass and accent highlights: use the `neu-*`, `accent-fill`, `glass`, `glass-card`, `hero-gradient` and `tint` utilities and the CSS variables in `src/index.css`, and the primitives in `src/components/ui.tsx` (`IconTile`, `Chips`, `ListGroup`/`ListItem`, `ActionBar`, `SelectCheck`). Every screen must work in light and dark themes and at 390px width.
- Layout is desktop sidebar + phone floating tab bar with a center create button. On phones, rows open a `BottomSheet` of actions on tap and enter multi-select on long-press (`ActionBar` replaces the tab bar while selecting). Use Modal (rendered as a bottom sheet on phones) or dedicated pages for forms; `BottomSheet` is for touch action menus and option pickers (`OptionSelect`) only.
- All backend calls use relative `/api/...` URLs through `src/lib/api`; components must not call `fetch` directly. Vite proxies to `127.0.0.1:8011` by default.
- Keep API error parsing in `src/lib/api/errors.ts`, preserve backend error codes and messages, and do not silently swallow failures.
- Runtime preferences come from `useAppSettings()`; `localStorage` is only for per-browser conveniences (cached theme, sidebar state, volume) and must be wrapped in try/catch.
- Use Vitest for business logic and meaningful interactions (default environment is node; opt into jsdom per file).
- Validate with `bun --bun run lint`, `bun --bun run test`, and `bun --bun run build`.
