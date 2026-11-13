---
title: Getting started
description: What Janosik is, how it runs, and the fastest path to a working board.
---

Janosik is a Kanban app for planning work on columns of cards. It installs as a
PWA and runs in **server mode**: the boards live behind an account, in
PostgreSQL, served by a NestJS API.

The board reducer can run without a server, but the **released app and the
development server always use the API**. Running `npm run dev` or opening the
built app shows a **sign-in screen**; they
do not open a no-login demo board. The only no-backend ("local-only") mode is the
one the **unit tests** run: the reducer over `localStorage`, with a seeded demo
board.

The self-host image serves the docs on the same origin as the app. A split
deployment (app and site on different hosts) wires the two cross-links by hand:
`VITE_SITE_URL` (UI build) points **Help → Documentation** at the site, and
`PUBLIC_APP_URL` (site build) points the **Sign in** / **Create account** CTAs at
the app — see [Split deployment](/docs/self-hosting/). In dev they are two
servers (app `:5173`, site `:4321`), so set both.

## Fastest path: the self-host image

One container serves the whole app (the API under `/api/v1`, the built SPA and
the marketing site) next to PostgreSQL and Redis. [Self-hosting](/docs/self-hosting/)
has the full guide; the short version:

```bash
curl -fsSLO https://raw.githubusercontent.com/VitalyTolstik/janosik/main/install.sh && bash install.sh
```

With Docker, Compose, curl and OpenSSL installed, this starts a local trial at
`http://localhost:3210/app/`. It requires a published stable release and image.
Create your account, then close registration. [Self-hosting](/docs/self-hosting/)
covers installation, updates, MCP and HTTPS.

## From source (development)

Prerequisites: Node.js 22.17 or newer — the repo pins **24** in `.nvmrc`
(`nvm install && nvm use`).

Configure the API **first**, then start the database: the dev compose file reads
`POSTGRES_*` from `backend/.env`, so that file must exist before
`docker compose up`.

```bash
cp backend/.env.example backend/.env                 # set JWT_SECRET
docker compose -f backend/docker-compose.yml up -d   # PostgreSQL on :5433
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend                             # API on :3000
npm run dev                                          # UI on :5173 (proxies /api → :3000)
```

Register at `http://localhost:5173` (registration is open by default) and create
the first master with `npm run admin:create -w backend -- --email me@example.com`
for the `/admin` panel. Every from-source step, per platform, is in
[Self-hosting](/docs/self-hosting/).

### Marketing site (Astro) in dev

The site and docs run as their own dev server (`npm run dev:site`, port 4321). In
dev the app is **not** served at `/app/` on the site — that path belongs to the
self-host image, where one server serves the site at `/` and the app at `/app/`.
So point the site's "Sign in" / "Create account" CTAs at the UI dev server, or
they 404:

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

### Outgoing email is off by default

With no SMTP transport configured the API runs in **log mode** and password
registration is unavailable. Configure a transport before registering
(see [Email service](/docs/admin/settings/) and [Runbooks](/docs/runbooks/)).
For a local sandbox:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
# SMTP localhost:1025, web inbox http://localhost:8025
```

## Where to go next

- [Self-hosting](/docs/self-hosting/) installs the server and the database, with
  TLS, per-OS Docker instructions and the environment reference.
- [Operations runbooks](/docs/runbooks/) covers backup, restore, upgrade, monitoring
  and troubleshooting.
- [User guide](/docs/user-guide/) tours the interface.
- [API reference](/docs/api/) documents the HTTP API for scripts and agents.
- [FAQ and troubleshooting](/docs/faq/) answers common questions.
