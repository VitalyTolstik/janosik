# Janosik

A premium, offline-first **Kanban board** — Trello-class drag & drop with a Space Grotesk wordmark and obsessive attention to micro-detail.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-801%20passing-brightgreen)](#)

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
- **Master panel** — a separate `/admin` area for the platform operator: metrics, all users and boards, command log, audit trail and moderation (block a user and their sessions die instantly, revoke API tokens, archive/soft-delete a board, create accounts with a one-time password). Master accounts live outside the user table, have their own login, cookie and JWT audience, and are created only by the server CLI (`npm run admin:create -w backend`); `OWNER` can add more masters, `OPERATOR` cannot.
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
| Tests | Vitest + React Testing Library (801 tests: ui + shared) |

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

## Master panel (platform admin)

Regular accounts are **not** admins — the panel at **`/admin`** belongs to the platform operator (the "master"), and there is deliberately no HTTP endpoint that can create a master: registration always creates a regular user, and no request can grant master rights. Masters live in their own table with their own login, cookie and JWT audience, so a user session can never open `/admin` (and a master token never works on user routes).

Create the first master on the server (the machine that runs the backend):

```bash
# from the repository root, backend deps installed, DATABASE_URL pointing at your DB
npm run admin:create -w backend -- --email me@example.com
# Password: ********        (hidden prompt; or set ADMIN_PASSWORD=... for automation)

# self-hosted in Docker:
docker compose exec backend npm run admin:create -- --email me@example.com
```

- The **first** master is an **OWNER** automatically; others are operators unless `--owner` is passed. Owners can add/block/reset masters right in the panel (**Masters** page); operators have full data access but cannot manage masters, so a stolen operator session cannot escalate.
- Other CLI helpers: `npm run admin:passwd -w backend -- --email me@example.com` (re-keys and revokes that master's sessions) and `npm run admin:list -w backend`.
- Sign in at `http://localhost:5173/admin` (dev) or `https://your-host/admin` (self-hosted).
- What you get there: metrics with 14-day sparklines plus a runtime card (version, uptime, DB latency), all users (search, filter, create with a one-time password, block → sessions die instantly, revoke API tokens), all boards (create for an owner, archive/restore, soft-delete), all cards and comments (search + moderation), active sessions and personal API tokens with per-row revoke, the cross-board command log, and the audit trail of every master action. Every row shows its database ID (click to copy) and search matches IDs. The board content editor (`/admin/boards/:id/content`) creates and renames columns and cards **through the command log on behalf of the board owner**, so the board UI stays consistent.
- Hardening that ships with it: argon2id hashes, 5-failed-login lockout (15 min) plus rate limiting, per-entity refresh rotation with reuse detection, response shapes that never include password/token hashes, and an audit row for every login attempt and mutation.

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
