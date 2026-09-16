# Janosik

A premium, offline-first **Kanban board** — Trello-class drag & drop with a Space Grotesk wordmark and obsessive attention to micro-detail.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-748%20passing-brightgreen)](#)

> **Janosik** is an offline-first board that installs as a **PWA** — and, since the backend phase landed, it also runs **server-backed**: accounts, shared boards and a command-log sync (`POST /boards/:id/commands`) on top of the very same reducer, with optimistic updates and undo. Point the UI at the API (`VITE_API_URL`, `/api/v1` by default) for server mode; without it the app keeps the original client-side mode (all data in `localStorage`, JSON export/import, automatic `IndexedDB` backups). Members UI, presence, comments UI and realtime SSE are next — see [ROADMAP.md §7](./ROADMAP.md).

---

## Highlights

- **Three board views** — Kanban, **Calendar** (drag deadlines, "unscheduled" panel, week/month, day panel) and **Table** (sorting, inline editing, configurable columns).
- **Drag & drop** — move cards within/between columns and reorder columns (`@dnd-kit`), inline Trello-style "+" zones, keyboard sensor and drag overlay.
- **Rich card content** — WYSIWYG description (MDXEditor), checklists with progress badges, due dates with overdue/soon badges, color/gradient covers, 14-color labels.
- **Card & board archive** — Trello-style archiving with restore (WIP-aware) and permanent delete; board archive with restore.
- **Multi-boards** — switcher, create/rename/archive/delete, deep links `/board/:id`, global search across boards with snippets.
- **Search & filters** — by title/description/labels, label ANY/ALL matching, due status, creation date; hotkeys `/` and `Ctrl/Cmd+K`, match counter.
- **WIP limits** — per-column caps with counters, blocked composers/drags and toasts.
- **Activity feed** — per-card event history (10 event types) with relative timestamps.
- **Keyboard-first** — shortcut palette (`?`), `j/k` cursor navigation, `n`/`c` composers, `e`/`Enter` edit.
- **Undo / redo** — 50-step history with coalescing, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, header buttons.
- **PWA / offline** — installable (manifest + icons), service worker caches the app shell and all hashed chunks; the board keeps working with the network fully cut.
- **Server mode** — sign in, and boards live in PostgreSQL: every edit travels the command log (`POST /boards/:id/commands`) through the same `boardReducer`, optimistic first, with rollback + toast on refusal; typed text is protected by per-entity version preconditions so undo never clobbers another member's edit. The local-only mode stays as the no-API fallback.
- **Fast by construction** — code-split bundle (editor & calendar load on demand), vendor chunks with stable cache keys; first paint ~212 ms on throttled CPU.
- **Data safety** — debounced saves, JSON export/import, automatic backups (20 snapshots, rotated), error boundary + toasts, input/collection limits everywhere.
- **Themes & polish** — dark/light with no-flash preflight, four board backgrounds, adjustable column glass, `prefers-reduced-motion`, custom scrollbars.
- **i18n** — English & Russian with type-safe keys and pluralization; 12h/24h time format toggle.
- **Brand** — Space Grotesk wordmark (self-hosted) + animated "Перо Яношика" feather logo.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 18, TypeScript 5.9 (strict) |
| Build | Vite 8 (Rolldown), Tailwind CSS v4 (CSS-first, `@theme inline`) |
| Components | shadcn/ui + Radix primitives (dialog, dropdown, popover, tooltip, slot) |
| Rich text | `@mdxeditor/editor` (WYSIWYG description, hardened import pipeline) |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` (board), native HTML5 DnD (calendar) |
| Calendar | `react-day-picker` (lazy-loaded, locale on demand), `date-fns` |
| State | React `useReducer` (pure reducer, 30+ actions) + context |
| Router | `react-router-dom` (`BrowserRouter`, `/board/:id`, `?card=` deep links; SPA-fallback: `deploy/nginx.conf`) |
| PWA | Hand-rolled service worker + web manifest (zero extra deps) |
| i18n | `i18next`, `react-i18next`, `i18next-browser-languagedetector` |
| Fonts | `@fontsource/space-grotesk` (self-hosted, no CDN) |
| Tests | Vitest + React Testing Library (622 tests / 60 files) |

---

## Quick start

**Prerequisites:** Node.js **20.19+** or **22.12+** (Vite 8 requirement), npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (team convention: port 5199, strict)
npm run dev -- --port 5199 --strictPort

# 3. Open
# http://localhost:5199/
```

On first launch the app shows a seeded **"Product Launch"** demo board. Everything you change is persisted locally. In production the app is installable (PWA) and keeps working offline.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + production build |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## Project structure

```text
janosik/
├─ public/                  # PWA: manifest, icons
├─ src/
│  ├─ components/
│  │  ├─ board/            # Columns, cards, card dialog, filters, views (board/calendar/table)
│  │  ├─ editor/           # MDXEditor description editor (plugins, code blocks, i18n)
│  │  ├─ ui/               # shadcn/ui + Radix primitives
│  │  ├─ Header.tsx        # Brand + search/language/time-format/undo/redo/data/theme
│  │  ├─ DataMenu.tsx      # Export/import JSON, backups, card archive
│  │  ├─ ErrorBoundary.tsx # Branded crash fallback (Reload / Reset)
│  │  └─ Toast.tsx         # Toast notifications
│  ├─ hooks/               # theme, board background, column glass, card labels
│  ├─ i18n/                # i18next setup (keys typed from the EN catalog), time format
│  ├─ locales/             # en/ru translation.json
│  ├─ pwa/                 # service worker + its registration (production only)
│  ├─ store/               # BoardContext, pure reducer, history, seed, migrations
│  ├─ types/               # Domain model (Board/Column/Card/Label) + LIMITS
│  ├─ utils/               # storage, persistence, backups, serialization, dnd, filter, due dates
│  ├─ App.tsx              # Provider tree + layout
│  ├─ main.tsx             # Theme preflight + SW registration + entry point
│  └─ index.css            # Design tokens (Tailwind v4 @theme)
├─ vite/                    # Build plugins (service worker emit + cache version)
├─ index.html
├─ vite.config.ts
├─ vitest.config.ts
├─ tsconfig*.json
└─ package.json
```

---

## Architecture (30 seconds)

- **Normalized data model** — a `Board` holds ordered `Column[]`, a `Record<string, Card>` and `Label[]`. Reordering = reordering id arrays. Archived cards stay in the map with `archivedAt` and are dropped from `column.cardIds` until restored.
- **Pure reducer** — `boardReducer` (30+ actions) is a pure function; every action returns a new board, which makes undo/redo, coalescing and testing trivial.
- **One provider, three contexts** — `BoardProvider` owns state, debounced persistence (400 ms), per-board history, hotkeys and auto-backups. It publishes the board data, the actions (assembled once, so write-only components never re-render) and undo availability separately. Components only call typed convenience actions (`addCard`, `moveCard`, …).
- **Persistence is swappable — and was swapped** — the `DebouncedPersistence` interface wraps `localStorage` for the local mode; server mode adds a fetch adapter (`ui/src/api/client.ts` + `store/server-sync.ts`) that ships the same actions to the command log **without touching the reducer or the UI** (optimistic updates on top of the same actions). In server mode board data is deliberately not mirrored into `localStorage` (accounts on a shared browser must not see each other's boards).
- **Performance** — the MDXEditor description editor and the calendar are lazy-loaded on first use; vendor libraries are split into stable chunks that the service worker caches; columns, cards, insert zones and table rows are memoized, so typing in one card re-renders only its own column (or table row) — the cost per keystroke no longer grows with the board.

See [ROADMAP.md](./ROADMAP.md) for the full architecture assessment, competitor comparison, the iteration log and the backend plan (accounts, shared boards with ADMIN/MEMBER/VIEWER roles, realtime).

---

## Contributing

1. Work happens in feature branches: `feature/TASK-{n}-{slug}` (e.g. `feature/TASK-3-card-checklists`).
2. Push the branch — a human reviews and merges; do not merge your own work.
3. Before pushing, make sure everything is green:

   ```bash
   npm test
   npx tsc -b --force
   npm run build
   ```

4. End-to-end tests (Playwright/Cypress) are intentionally **out of scope** — testing is Vitest + React Testing Library.
5. New UI strings land in both `src/locales/en` and `src/locales/ru` synchronously; colors come only from the design tokens in `src/index.css`.
6. The backend phase is active — see `ROADMAP.md` §7 for the fixed stack (NestJS/Prisma/PostgreSQL/JWT) and iteration order.
7. By submitting a pull request you agree that your contribution is licensed under the [MIT License](./LICENSE), the same terms as the rest of the project.

---

## License

[MIT](./LICENSE) © 2026 Vitali Toustsik

Use it, fork it, run it, build on it — commercially too. The only condition is
that the copyright notice and the license text travel with the copies. The
software comes with no warranty.
