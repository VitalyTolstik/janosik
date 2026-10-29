# Janosik

A premium **Kanban board** — Trello-class drag & drop with a Space Grotesk wordmark and obsessive attention to micro-detail. **Server mode** (accounts, shared boards, realtime sync) on an offline-first foundation: the whole board lives in one pure reducer, every edit runs through a shared command log, and the app is an installable PWA.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![NestJS](https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white)](https://nestjs.com)
[![Tests](https://img.shields.io/badge/tests-932%20passing-brightgreen)](#)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)

> **Janosik** installs as a **PWA** and runs in **server mode**: accounts, shared boards and a command-log sync (`POST /boards/:id/commands`) sit on top of one pure reducer (`boardReducer`) shared by the UI and the API, with optimistic updates and undo. The reducer is offline-first by design and the **unit tests** run it with no API (data in `localStorage`); the dev and production builds always talk to the API (`VITE_API_URL`, `/api/v1` by default) and show a sign-in screen. Members UI, **realtime SSE** (everyone sees each other's edits without a reload, dropped streams catch up from `?since=`), presence and the comments UI have all landed — see [ROADMAP.md §7](./ROADMAP.md).

---

## Repository layout — what `ui`, `shared` and `backend` are

This is an **npm-workspaces monorepo**. Three packages, one `npm install` at the root. The rule of thumb: **`shared` is a library, `ui` and `backend` are programs that use it.**

| Workspace | npm name | What it is | How it runs |
| --- | --- | --- | --- |
| **`ui/`** | `@janosik/ui` | The **frontend**: the whole single-page app — board/calendar/table views, drag & drop, card dialog, search, settings, i18n, PWA service worker, the login screen and the `/admin` master panel. It talks to the backend over `fetch`. | Vite dev server (`npm run dev`) or is served as static files from `ui/dist` |
| **`shared/`** | `@janosik/shared` | A **TypeScript library with no build step and no runtime of its own**: the domain model (`Board`/`Column`/`Card`/`Label`), the pure `boardReducer` (the single implementation of every board operation), its inverse for undo, command validation, export/import serialization, storage keys — plus the **typed API contracts** (user and admin DTOs). | Nothing to run. `ui` and `backend` import its `.ts` sources directly through aliases, so client and server literally share the same types and the same reducer logic |
| **`backend/`** | `@janosik/backend` | The **server**: a NestJS API on PostgreSQL — auth (JWT + refresh rotation + argon2id), boards/members, the command log that persists UI actions, comments/activity, and the isolated master-admin contour (`/api/v1/admin/*`). | Node process (`npm run build:backend` + `npm run start -w backend`); dev DB via Docker Compose |

Why `shared` matters: a board mutation is written **once** (in the reducer), executed in the browser for instant feedback and on the server when the command arrives — so a card can never move differently in the UI and in the database. The same applies to validation and to DTO types: change a field in `shared/src/admin.ts` and both sides fail to compile until they agree.

```text
janosik/                        # npm workspaces root (one package-lock.json)
├─ ui/                          # @janosik/ui — the React PWA (see tree below)
├─ shared/                      # @janosik/shared — the domain library
│  └─ src/
│     ├─ types/kanban.ts        # Board / Column / Card / Label + LIMITS
│     ├─ store/
│     │  ├─ board-reducer.ts    # the pure reducer — every board action
│     │  ├─ invert.ts           # inverse actions for undo/redo
│     │  ├─ validate.ts         # strict command validator (both sides)
│     │  ├─ migrate.ts          # persisted-state migrations
│     │  └─ seed-data.ts        # demo "Product Launch" board
│     ├─ utils/                 # export/import envelope, limits, text, storage keys
│     ├─ api.ts                 # user API DTOs (auth, boards, commands…)
│     └─ admin.ts               # admin API DTOs (users, boards, cards, masters…)
├─ backend/                     # @janosik/backend — the NestJS API
│  ├─ prisma/                   # schema.prisma + versioned migrations
│  ├─ src/                      # auth/ boards/ commands/ comments/ activity/
│  │                            # admin/ users/ health/ config/ (+ shared → ../../shared/src)
│  ├─ test/                     # Jest + Supertest e2e specs (real test DB)
│  ├─ scripts/                  # admin-cli.cjs, migrate-test-db.cjs
│  ├─ docker-compose.yml        # dev PostgreSQL 16 (janosik + janosik_test)
│  └─ .env.example
├─ mcp/                         # @janosik/mcp — the MCP server: the board as agent tools
│  ├─ src/                      # client + 13 tool groups (71 tools), toolset gating
│  ├─ server.json               # MCP Registry metadata (published as io.github.vitalytolstik/janosik)
│  └─ scripts/smoke.mjs         # live smoke test against a running instance
├─ skills/janosik/              # the agent skill (behaviour playbook for the MCP tools)
│  ├─ SKILL.md                  #   the behaviour a harness loads
│  └─ references/               #   card/comment templates + lifecycle recipes
├─ deploy/nginx.conf            # optional SPA fallback + /api proxy (single-image serving is built in)
├─ Dockerfile                   # multi-stage: builds UI + API into one self-host image
├─ docker-compose.yml           # self-host stack: app + postgres + redis
├─ docker-entrypoint.sh         # runs `prisma migrate deploy`, then the API
├─ .env.example                 # annotated environment for docker compose
├─ SECURITY.md / CHANGELOG.md   # disclosure policy, release history
├─ LICENSE / TRADEMARK.md       # AGPL-3.0 terms + brand/trademark policy
├─ docs/SELF-HOSTING.md         # full self-hosting guide (TLS, backups, ops)
├─ docs/INSTALL-BY-OS.md        # running it on macOS / Windows 11 / Linux
├─ ROADMAP.md                   # plan, architecture assessment, §7 backend spec
├─ ROADMAP-DONE.md              # archive of closed tasks
└─ AGENT.md                     # working agreement for AI agents/contributors
```

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
- **PWA** — installable (manifest + icons), service worker caches the app shell and all hashed chunks, so it opens with the network cut. Writes need the network (optimistic edits roll back with a toast if the API is unreachable — there is no persistent outbox yet, so a reload drops unsynced changes); reads keep working offline from the last fetch.
- **Server mode** — sign in, and boards live in PostgreSQL: every edit travels the command log (`POST /boards/:id/commands`) through the same `boardReducer`, optimistic first, with rollback + toast on refusal; typed text is protected by per-entity version preconditions so undo never clobbers another member's edit. Sign-out is always visible in the board header, and HTTP keepalive delivers a command that was already in flight if the tab reloads. The reducer stays offline-first; the no-API (local-only) mode ships in the unit tests, not in the dev/prod build.
- **Realtime** — a `GET /boards/:id/events` SSE stream carries every committed command (`{type, seq, action, actorId}`) and the client replays foreign actions through the very same reducer. Edits appear in other browsers with no reload; a dropped stream resumes exactly where it stopped (`?since=`) and window focus remains the fallback. Your own commands are never applied twice, and a stale undo still refuses to clobber someone else's text.
- **Shared boards** — a **Members (N)** dialog in the header: admins invite by email, switch roles (`ADMIN`/`MEMBER`/`VIEWER`), bound a viewer's access with an expiry date ("access expired" badge) and remove members — the last admin can never be demoted or removed. Invitations are **opt-in**: the invitee gets a badge on the header bell and accepts or declines there; nothing is shared until they accept. Everyone else sees the same member list read-only, and a `VIEWER` gets a genuinely read-only board: no drag, no composers, no menus, no inline editors, a read-only card dialog — while the server independently answers 403 to every mutation.
- **Master panel** — a separate `/admin` area for the platform operator: metrics, all users and boards, command log, audit trail and moderation (block a user and their sessions die instantly, revoke API tokens, archive/soft-delete a board, create accounts with a one-time password). Master accounts live outside the user table, have their own login, cookie and JWT audience, and are created only by the server CLI (`npm run admin:create -w backend`); `OWNER` can add more masters, `OPERATOR` cannot. Panel tables are **schema-first**: columns are named after Prisma fields (`Board.id`, `BoardMember.userId`, `Card.columnId`, `Comment.authorId`, …), foreign keys are shown as copyable IDs (title/email only as a caption) and search matches those IDs — a row can be traced to its parents even when names are not unique.
- **AI agents (MCP + skill)** — `@janosik/mcp` exposes the whole board to any MCP client (Claude, Cursor, VS Code, opencode, Codex) over a personal API key, and the `janosik` skill teaches the agent *how* to behave: comment at every step, fill a card so it stands on its own, move it through the columns, and — when a bug turns up — return the card with the evidence instead of burying it. Writes go through the same command log, so an agent's work is undoable, streamed live, and keeps the full history. See [Drive it from an AI agent](#drive-it-from-an-ai-agent-mcp--skill).
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
| State | React `useReducer` (pure reducer in `shared`, 30+ actions) + context |
| Router | `react-router-dom` (`BrowserRouter`, `/board/:id`, `?card=` deep links; SPA-fallback: `deploy/nginx.conf`) |
| PWA | Hand-rolled service worker + web manifest (zero extra deps) |
| i18n | `i18next`, `react-i18next`, `i18next-browser-languagedetector` |
| Fonts | `@fontsource/space-grotesk` (self-hosted, no CDN) |
| Shared | `@janosik/shared` — domain model, reducer + inverse, validation, DTO contracts (imported as TS source, no build step) |
| Backend | NestJS 11, Prisma 6, PostgreSQL 16, JWT (`@nestjs/jwt`) + refresh rotation, argon2id, helmet, rate limiting |
| Tests | Vitest + React Testing Library (ui 485, shared 325) + Jest + Supertest (backend 22 unit, 100 e2e against a real test DB) — 932 total |

---

## Quick start

**Prerequisites:** Node.js **22.17+** — the repo pins **24** via `.nvmrc` (`nvm use`), and that is what CI runs. npm. Docker for server mode (PostgreSQL/Redis).

> Per-OS walkthroughs (macOS, Windows 11, Linux) — both Docker and from-source, with the OS-specific gotchas — live in **[docs/INSTALL-BY-OS.md](./docs/INSTALL-BY-OS.md)**.

### Server mode (accounts + PostgreSQL)

The dev UI is **always in server mode**: it calls `/api/v1` (Vite proxies it to `:3000`), so you get a **sign-in screen** and `npm run dev` alone does not show a board. Bring the database and API up first:

```bash
# 1. Configure the API FIRST — the dev compose file reads POSTGRES_* from
#    backend/.env, so it must exist before `docker compose up`.
cp backend/.env.example backend/.env
#    set JWT_SECRET (openssl rand -hex 32); DATABASE_URL/TEST_DATABASE_URL
#    already point at the container.

# 2. Start the dev database (container `janosik-postgres`, port 5433)
docker compose -f backend/docker-compose.yml up -d

# 3. Apply migrations and build + start the API (port 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. In a second terminal, start the UI; Vite proxies /api to :3000
npm run dev
```

Register at <http://localhost:5173> (registration is open by default) — the boards then live in PostgreSQL and sync through the command log. To open the master panel at `/admin`, create the first master on the server (see below).

> **Local-only / no-API build.** The app can also render with no backend — that is the in-browser mode the **unit tests** use (`MODE=test`), with the seeded "Product Launch" board in `localStorage`. The `npm run dev` / `npm run build` builds are **not** that mode: they always talk to the API and show the login screen, so "just look at the demo board, no login" is not available from the dev server.

### Marketing site (Astro) — dev

The marketing site and docs live in `site/` (Astro + Starlight) and run on their own dev server:

```bash
npm run dev:site                 # Astro dev server, default port 4321
```

In dev the app is **not** served under `/app/` on the site — that path belongs to the **self-host image**, where one server serves the site at `/` and the app at `/app/`. So the site's "Sign in" / "Create account" CTAs must be pointed at the UI dev server, otherwise they 404:

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

The reverse link — the in-app **Help → Documentation** — points at the site, so give the UI dev server `VITE_SITE_URL` (otherwise it opens `/docs/` on the UI origin and hits the not-found page):

```bash
VITE_SITE_URL=http://localhost:4321/ npm run dev
```

The self-host image sets both by serving the site at `/` and the app at `/app/` on one origin; a **split deployment** (two hosts) sets `PUBLIC_APP_URL` and `VITE_SITE_URL` to the two origins — see [docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md).

### Enabling outgoing email (optional — off by default)

**Email delivery is not enabled by default.** The API boots fine with no mail
setup: with no SMTP transport configured it runs in **log mode** — every message
(verification codes, email-change notices) is written to the server log instead
of being sent, and registration auto-verifies so nobody is locked out. Messages
are never actually delivered until you configure a transport in the master panel.

To actually send mail, open **`/admin` → Email service** (owner only), pick a preset and paste the credentials, then flip **Enable delivery** and hit **Send test email**:

- **Gmail / Yandex / Mail.ru** — free for a personal account, but you need an **app password** (2-step verification enabled), not your login password.
- **Brevo / SendGrid** — transactional relays with solid free tiers (username `apikey` + API key for SendGrid).
- **Custom SMTP** — any host / port / TLS.

**Trying it out locally (Mailpit).** The **Mailpit (sandbox)** preset sends to a local catcher and needs no credentials — letters land in a web inbox instead of a real address. Start it, then open the inbox:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 axllent/mailpit
# open http://localhost:8025, or click "Open the inbox" in the panel
```

### Self-hosting with Docker (production)

The fastest way to run Janosik is the prebuilt image: one container serves the
**whole app** (API under `/api/v1` + the built SPA), next to PostgreSQL and
Redis. No separate web server or proxy config — SSE and cookies work on a
single origin.

```bash
# 1. Grab the compose file and the env template
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example

# 2. Edit .env — at minimum JWT_SECRET and PUBLIC_ORIGIN:
#    JWT_SECRET=$(openssl rand -hex 32)
#    For this plain-HTTP quickstart also set COOKIE_SECURE=false (the safe
#    default is true; over HTTP the API refuses to boot rather than drop the
#    refresh cookie). Behind HTTPS keep it true.

# 3. Bring it up (migrations run automatically on boot)
docker compose up -d

# 4. Open PUBLIC_ORIGIN (default http://localhost:3000), create the first
#    account, then set ALLOW_REGISTRATION=false in .env and `docker compose up -d`
```

Create a **master (platform admin)** account for the `/admin` panel — the CLI
is the only door, there is deliberately no HTTP endpoint for it:

```bash
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
# (hidden password prompt; the first master becomes OWNER)
docker compose exec app node backend/scripts/admin-cli.cjs list
# then sign in at PUBLIC_ORIGIN/admin
```

Upgrade and back up:

```bash
docker compose pull && docker compose up -d          # new image, schema migrated on boot
docker compose exec postgres pg_dump -U janosik janosik > backup.sql
# restore: docker compose exec -T postgres psql -U janosik janosik < backup.sql
```

Environment variables (see `.env.example` for the full annotated list):

| Variable | Default | Meaning |
| --- | --- | --- |
| `JWT_SECRET` | — (required) | Access-token signing secret; `openssl rand -hex 32` |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Public URL users open; builds OAuth callbacks |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `janosik` / — / `janosik` | Database credentials |
| `COOKIE_SECURE` | `true` | `Secure` cookie flag. Keep `true` behind HTTPS (the API refuses to boot on HTTP in production); set `false` only for a plain-HTTP trial. |
| `ALLOW_REGISTRATION` | `true` | Open sign-up; turn off after creating your account |
| `TRUST_PROXY` | `0` | Reverse-proxy hops (set `1` behind nginx/Caddy/Traefik) |
| `SMTP_*` | unset | Outgoing email. Unset = log mode; in production codes are withheld from the log, so configure SMTP to deliver them. |
| `PURGE_AFTER_DAYS` | `30` | Retention for the hourly soft-delete sweep |
| `AUDIT_RETENTION_DAYS` | `365` | Retention for the master audit trail (separate, longer window) |
| `DB_CONNECTION_LIMIT` | `10` | Prisma pool size per API process (keeps replicas under `max_connections`) |
| `SLOW_QUERY_MS` | `200` | Log Prisma queries slower than this (0 = off) |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | Postgres `shared_buffers` for the bundled container |
| `POSTGRES_WORK_MEM` | `8MB` | Postgres `work_mem` for the bundled container |
| `POSTGRES_MAX_CONNECTIONS` | `100` | Postgres `max_connections` for the bundled container |

To build the image from a checkout instead of pulling, uncomment `build: .`
in `docker-compose.yml`. For a TLS-terminating proxy in front, keep
`PUBLIC_ORIGIN=https://…`, set `COOKIE_SECURE=true` and `TRUST_PROXY=1`.

**Full guide** — TLS setup (Caddy/nginx/Traefik), backups & restore, the
environment reference and troubleshooting: **[docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md)**.

---

## Master panel (platform admin)

Regular accounts are **not** admins — the panel at **`/admin`** belongs to the platform operator (the "master"), and there is deliberately no HTTP endpoint that can create a master: registration always creates a regular user, and no request can grant master rights. Masters live in their own table with their own login, cookie and JWT audience, so a user session can never open `/admin` (and a master token never works on user routes).

### Creating a master account (`admin:create`)

The CLI is the only door: registration always creates regular users, and no API call can grant master rights. Run the commands from the repository root, with backend dependencies installed and `backend/.env` present (its `DATABASE_URL` must point at the same database the API uses).

```bash
# 1. Interactive (recommended) — the password is typed at a hidden prompt
#    twice (it must match), nothing lands in the shell history.
npm run admin:create -w backend -- --email me@example.com
# Password: ********
# Repeat password: ********
# Master account created: me@example.com (owner)   ← first master ⇒ OWNER

# 2. Non-interactive (CI/automation) — password via environment, never argv.
#    `read -s` keeps it out of the shell history too.
read -s ADMIN_PASSWORD && export ADMIN_PASSWORD
npm run admin:create -w backend -- --email ci@example.com
unset ADMIN_PASSWORD

# 3. Explicit role and display name: --owner makes this master an OWNER
#    (without it a second master is created as OPERATOR).
npm run admin:create -w backend -- --email ops@example.com \
  --display-name "Ops" --owner

# 4. Re-key an existing master: sets a new password, revokes every session
#    of that master and clears any lockout. Same password rules.
npm run admin:passwd -w backend -- --email me@example.com

# 5. Who exists: email, role, display name, last login, disabled/locked
#    flags. No secrets are ever printed.
npm run admin:list -w backend
# me@example.com  owner  -  never logged in

# Full reference, straight from the CLI:
npm run admin:create -w backend -- --help
```

Rules worth knowing:

- **Password**: 8–100 characters. There is deliberately **no `--password` flag** — a password in `argv` leaks into `ps` output and shell history. Without a TTY and without `ADMIN_PASSWORD` the CLI refuses to run.
- **Role**: the **first** master in an empty database becomes `OWNER` automatically; every later CLI master is `OPERATOR` unless `--owner` is passed. Owners can add/block/reset masters right in the panel (**Masters** page); operators have full data access but cannot manage masters, so a stolen operator session cannot escalate.
- **Email** is required and normalized to lowercase; creating a duplicate fails with a hint to use `admin:passwd`.
- **Audit**: every create/re-key writes an `AdminAuditLog` row (`via: "cli"`), visible on the panel's **Audit** page.
- Sign in at `http://localhost:5173/admin` (dev) or `https://your-host/admin` (self-hosted). Sign-out sits in the top-right corner.
- What you get there: metrics with 14-day sparklines plus a runtime card (version, uptime, DB latency), all users (search, filter, create with a one-time password, block → sessions die instantly, revoke API tokens), all boards (create for an owner, archive/restore, soft-delete), all cards and comments (search + moderation), active sessions and personal API tokens with per-row revoke, the cross-board command log, and the audit trail of every master action. Tables follow the database schema (see Highlights) and search matches foreign-key IDs. The board content editor (`/admin/boards/:id/content`) creates and renames columns and cards **through the command log on behalf of the board owner**, so the board UI stays consistent.
- Hardening that ships with it: argon2id hashes, 5-failed-login lockout (15 min) plus rate limiting, per-entity refresh rotation with reuse detection, response shapes that never include password/token hashes, and an audit row for every login attempt and mutation.

---

## Drive it from an AI agent (MCP + skill)

Janosik is built so a swarm of AI agents can work a board alongside people. Two
pieces make that real, and they are deliberately separate:

- **`@janosik/mcp` — the tools (the "hands").** An MCP server that exposes the
  whole board — boards, columns, cards, labels, checklists, links, comments,
  activity and attachments (plus, opt-in, members, invitations, share links and
  the account) — to any MCP client. It talks to your instance with a personal
  API key (`jnk_…`) and routes every write through the same command log the UI
  uses, so an agent's changes are undoable and stream live to everyone watching.
- **`skills/janosik` — the behaviour (the "manners").** A playbook that tells
  the agent *how* to work: read before writing, claim a card, fill it so it
  stands on its own, comment at every step, move it through the columns, and —
  when a bug turns up — move the card back with the evidence instead of marking
  it Done.

### 1. Get an API key

In the app: **Account → API keys → create** (starts with `jnk_`). Give each
agent its **own user account and key**, so the activity feed shows who did what
and revoking one key stops one agent.

### 2. Add the MCP server

```json
{
  "mcpServers": {
    "janosik": {
      "command": "npx",
      "args": ["-y", "@janosik/mcp"],
      "env": {
        "JANOSIK_URL": "https://boards.example.com",
        "JANOSIK_TOKEN": "jnk_…"
      }
    }
  }
}
```

Works in Claude Desktop/Code, Cursor, VS Code, opencode and Codex.
`JANOSIK_APP_BASE` is only needed when the app is not at the site root (e.g.
`/app`). By default the server registers the board-work tools; member,
invitation, share and account tools are opt-in (`JANOSIK_MCP_TOOLSETS`), and
attachment upload/download stays off until you set `JANOSIK_MCP_ALLOW_FS=1`.

### 3. Add the skill

Drop `skills/janosik/` into your harness's skills directory — Claude Code:
`~/.claude/skills/`, opencode: `~/.config/opencode/skills/`, agent-compatible
harnesses: `~/.agents/skills/`. Details in
[skills/janosik/README.md](./skills/janosik/README.md). The skill needs no
configuration; it just makes the agent follow the board's conventions.

### What the agent does with it

Picks up a card, comments as it goes, fills the description and checklist, moves
it **In Progress → Review → Done**, and on a bug moves it **back** (to Bugs /
In Progress) with a comment describing the defect — so a reviewer sees the card
travel forward, back and forward again, with a reason at every turn. That
backward move plus the comment is the audit trail.

Full guide in-repo: [mcp/README.md](./mcp/README.md) and
[skills/janosik/SKILL.md](./skills/janosik/SKILL.md).

---

## Scripts

Root scripts fan out to the workspaces (`-w ui`, `-w shared`, `-w backend`, `-w site`, `-w mcp`, …):

| Command | What it does |
| --- | --- |
| `npm run dev` | UI dev server (`npm run dev -w ui`; default port 5173, proxies `/api` to `:3000`) |
| `npm run dev:site` | Marketing site + docs dev server (`npm run dev -w site`; Astro, default port 4321) |
| `npm run build:site` | Build the Astro site (`site/dist`) |
| `npm run build:mcp` | Build the MCP server (`mcp/dist`) |
| `npm run build` | Type-check + build the UI (`ui/dist`) |
| `npm run build:backend` | Prisma generate + compile the API (`backend/dist`) |
| `npm run preview` | Serve the built UI locally |
| `npm test` | UI + shared test suites (Vitest) |
| `npm run test:backend` | Backend Jest unit + e2e (e2e creates/migrates `janosik_test` first) |
| `npm run test:coverage` | Vitest coverage for ui + shared |
| `npm run lint` | ESLint in all three workspaces |
| `npm run format` / `format:check` | Prettier write / verify (repo-wide) |
| `npm run size` | size-limit budgets for the UI bundle (entry, lazy chunks, admin chunk) |

Workspace-specific extras worth knowing:

| Command | What it does |
| --- | --- |
| `npm run start -w backend` | Run the built API (`node backend/dist/main.js`) |
| `npm run prisma:deploy -w backend` | Apply Prisma migrations to `DATABASE_URL` |
| `npm run admin:create/passwd/list -w backend` | Master-account CLI (see above) |
| `npm run test:watch -w ui` | Vitest in watch mode |

---

## Project structure (UI workspace in detail)

```text
ui/
├─ public/                  # PWA: manifest, icons
├─ src/
│  ├─ admin/                # master panel (/admin): pages, admin-client, i18n, fake API
│  ├─ api/                  # fetch client (tokens, auth-lost callback, keepalive commands)
│  ├─ auth/                 # AuthContext (session, login/register/logout)
│  ├─ components/
│  │  ├─ board/             # Columns, cards, card dialog, filters, views (board/calendar/table)
│  │  ├─ auth/              # LoginPage, logout confirmation
│  │  ├─ account/           # personal panel: profile, password, API keys, preferences
│  │  ├─ editor/            # MDXEditor description editor (plugins, code blocks, i18n)
│  │  └─ ui/                # shadcn/ui + Radix primitives
│  ├─ hooks/                # theme, board background, column glass, card labels
│  ├─ i18n/                 # i18next setup (keys typed from the EN catalog), time format
│  ├─ locales/              # en/ru translation.json
│  ├─ pwa/                  # service worker + its registration (production only)
│  ├─ store/                # BoardContext, history, server-sync, persistence adapters
│  ├─ types/                # UI-only types (domain model lives in @janosik/shared)
│  ├─ utils/                # storage, persistence, backups, serialization, dnd, filter, due dates
│  ├─ App.tsx               # Provider tree + layout (+ lazy /admin route)
│  ├─ main.tsx              # Theme preflight + SW registration + entry point
│  └─ index.css             # Design tokens (Tailwind v4 @theme)
├─ vite/                    # Build plugins (service worker emit + cache version)
├─ index.html
├─ vite.config.ts
├─ vitest.config.ts
└─ package.json
```

---

## Architecture (30 seconds)

- **Normalized data model** — a `Board` holds ordered `Column[]`, a `Record<string, Card>` and `Label[]`. Reordering = reordering id arrays. Archived cards stay in the map with `archivedAt` and are dropped from `column.cardIds` until restored.
- **Pure reducer in `shared`** — `boardReducer` (30+ actions) is a pure function; every action returns a new board, which makes undo/redo, coalescing and testing trivial. The backend executes the identical reducer when a command reaches the command log, so UI and server can never diverge.
- **One provider, three contexts** — `BoardProvider` owns state, debounced persistence (400 ms), per-board history, hotkeys and auto-backups. It publishes the board data, the actions (assembled once, so write-only components never re-render) and undo availability separately. Components only call typed convenience actions (`addCard`, `moveCard`, …).
- **Persistence is swappable — and was swapped** — the `DebouncedPersistence` interface wraps `localStorage` for the local mode; server mode adds a fetch adapter (`ui/src/api/client.ts` + `ui/src/store/server-sync.ts`) that ships the same actions to the command log **without touching the reducer or the UI** (optimistic updates on top of the same actions). In server mode board data is deliberately not mirrored into `localStorage` (accounts on a shared browser must not see each other's boards).
- **Performance** — the MDXEditor description editor and the calendar are lazy-loaded on first use; vendor libraries are split into stable chunks that the service worker caches; columns, cards, insert zones and table rows are memoized, so typing in one card re-renders only its own column (or table row) — the cost per keystroke no longer grows with the board.

See [ROADMAP.md](./ROADMAP.md) for the full architecture assessment, competitor comparison, the iteration log and the backend plan (accounts, shared boards with ADMIN/MEMBER/VIEWER roles, realtime).

---

## Contributing

1. Work happens in feature branches off `main` — `feat/<slug>`, `fix/<slug>` or `chore/<slug>`; never commit to `main` directly. Open a PR and let CI run.
2. Before pushing, make sure everything is green:

   ```bash
   npm run lint
   npm run format:check
   npm test
   npm run test:backend   # needs the dev database running
   npm run build
   npm run size
   ```

3. Browser end-to-end tests (Playwright/Cypress) are intentionally **out of scope** — UI testing is Vitest + React Testing Library, the backend e2e suite is Jest + Supertest against a real PostgreSQL test database.
4. New UI strings land in both `src/locales/en` and `src/locales/ru` synchronously; colors come only from the design tokens in `src/index.css`.
5. Change the data model, a board operation, validation or an API contract in `@janosik/shared` first — both `ui` and `backend` compile against it.
6. The backend follows the fixed stack in `ROADMAP.md` §7 (NestJS/Prisma/PostgreSQL/JWT) and its iteration order.
7. By submitting a pull request you agree that your contribution is licensed under the [AGPL-3.0 License](./LICENSE), the same terms as the rest of the project.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide — dev setup, the gate commands, and the required DCO sign-off (`git commit -s`).

---

## License

[AGPL-3.0](./LICENSE) © 2026 Vitali Toustsik

Use it, self-host it, fork it, modify it — commercially too. The one condition
AGPL-3.0 adds over a permissive licence: if you run a modified version as a
network service, you must offer its source to the people who use it. That keeps
the hosted edition honest — nobody can quietly run a closed fork as a SaaS.

**Trademarks.** The licence covers the code, not the name. "Janosik" and the
feather mark identify this project; forks are welcome but must not present
themselves as the official Janosik or its hosted service — see
[TRADEMARK.md](./TRADEMARK.md).
