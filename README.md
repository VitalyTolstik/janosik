# Janosik

A premium, offline-first **Kanban board** — Trello-class drag & drop with a Space Grotesk wordmark and obsessive attention to micro-detail.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-103%20passing-10b981?logo=vitest&logoColor=white)](https://vitest.dev)

> **Janosik** is a single-user, fully client-side board. All data lives in your browser (`localStorage`) with JSON export/import and automatic `IndexedDB` backups — **no server required**.

---

## Highlights

- **Drag & drop** — move cards within/between columns and reorder columns (`@dnd-kit`), with keyboard sensor and a drag overlay.
- **14-color labels** — multi-select, create / rename / recolor / delete with cascade.
- **Search & filters** — by title, by labels (ANY + "no label"), and by creation date (today / 7 / 30 days / exact day via calendar). Hotkeys `/` and `Ctrl/Cmd+K`.
- **Card details** — live title editing, plain-text description, label picker, move-to-column, delete with confirmation.
- **Undo / redo** — 50-step history with coalescing, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, header buttons.
- **Data safety** — debounced saves, JSON export/import, automatic backups (20 snapshots, rotated), error boundary + toasts.
- **Themes & polish** — dark/light themes with no-flash preflight, four board backgrounds (solid / paper / dots / grid), `prefers-reduced-motion`, custom scrollbars, GPU animations.
- **i18n** — English & Russian with type-safe keys and pluralization.
- **Brand** — Space Grotesk wordmark (self-hosted) + animated "Перо Яношика" feather logo.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 18, TypeScript 5.9 (strict) |
| Build | Vite 8, Tailwind CSS v4 (CSS-first, `@theme inline`) |
| Components | shadcn/ui + Radix primitives (dialog, dropdown, popover, tooltip, slot) |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` |
| State | React `useReducer` (pure reducer) + context |
| i18n | `i18next`, `react-i18next`, `i18next-browser-languagedetector` |
| Dates | `date-fns`, `react-day-picker` |
| Fonts | `@fontsource/space-grotesk` (self-hosted, no CDN) |
| Tests | Vitest + React Testing Library |

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

On first launch the app shows a seeded **"Product Launch"** demo board. Everything you change is persisted locally.

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
├─ src/
│  ├─ components/
│  │  ├─ board/            # Columns, cards, card dialog, filters, DnD board
│  │  ├─ ui/               # shadcn/ui + Radix primitives
│  │  ├─ Header.tsx        # Brand + background/language/undo/redo/data/theme
│  │  ├─ DataMenu.tsx      # Export/import JSON + automatic backups
│  │  ├─ ErrorBoundary.tsx # Branded crash fallback (Reload / Reset)
│  │  └─ Toast.tsx         # Toast notifications
│  ├─ hooks/               # use-theme, use-board-background
│  ├─ i18n/                # i18next setup (keys typed from the EN catalog)
│  ├─ locales/             # en/ru translation.json
│  ├─ store/               # BoardContext, pure reducer, history, seed, migrations
│  ├─ types/               # Domain model (Board/Column/Card/Label) + backgrounds
│  ├─ utils/               # storage, persistence, backups, serialization, dnd, filter
│  ├─ App.tsx              # Provider tree + layout
│  ├─ main.tsx             # Theme preflight + entry point
│  └─ index.css            # Design tokens (Tailwind v4 @theme)
├─ index.html
├─ vite.config.ts
├─ vitest.config.ts
├─ tsconfig*.json
└─ package.json
```

---

## Architecture (30 seconds)

- **Normalized data model** — a `Board` holds ordered `Column[]`, a `Record<string, Card>`, and `Label[]`. Reordering = reordering id arrays. The `Board[]` top-level shape is already multi-board ready.
- **Pure reducer** — `boardReducer` (15 actions) is a pure function; every action returns a new board, which makes undo/redo and testing trivial.
- **One provider** — `BoardProvider` owns state, debounced persistence (400 ms), history, hotkeys and auto-backups. Components only call typed convenience actions (`addCard`, `moveCard`, …).
- **Persistence is swappable** — a `DebouncedPersistence` interface wraps `localStorage` today; a `fetch` adapter to a backend can drop in later **without touching the reducer or UI**.

See [ROADMAP.md](./ROADMAP.md) for the full architecture assessment, competitor comparison and the planned iteration steps.

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
5. Backend work is **deferred** — see `ROADMAP.md`.

---

## License

Private project — not yet released under an open-source license.
