---
title: Getting started
description: What Janosik is, the two ways it runs, and the fastest path to a working board.
---

Janosik is a Kanban app for planning work on columns of cards. It installs as
a PWA and runs in one of two modes.

## Two ways to run

| Mode | Backend | Data lives in | Best for |
| --- | --- | --- | --- |
| Local-only | none | the browser (`localStorage`) | trying it out, offline use, a single person |
| Server-backed | NestJS API and PostgreSQL | a database behind an account | accounts, shared boards, realtime |

The build decides the mode. When the UI is pointed at an API (`VITE_API_URL`,
`/api/v1` by default) it runs in server mode; without a backend it keeps the
local-only mode. The [User guide](user-guide/) explains both in detail.

## Fastest path: the self-host image

One container serves the whole app (the API under `/api/v1`, the built SPA and
the marketing site) next to PostgreSQL and Redis. [Self-hosting](self-hosting/)
has the full guide; the short version:

```bash
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
# edit .env: set JWT_SECRET (openssl rand -hex 32) and PUBLIC_ORIGIN
docker compose up -d
```

Migrations run on boot. Open the app, create your account, then close
registration. [Self-hosting](self-hosting/) covers the first run step by step.

## From source (development)

Prerequisites: Node.js 22.17 or newer and npm.

Local-only mode needs no backend:

```bash
npm install
npm run dev
# http://localhost:5173/
```

Server mode adds a PostgreSQL container and the API. See
[Self-hosting](self-hosting/) for the from-source steps on every platform.

## Where to go next

- [Self-hosting](self-hosting/) installs the server and the database, with
  TLS, per-OS Docker instructions and the environment reference.
- [Operations runbooks](runbooks/) covers backup, restore, upgrade, monitoring
  and troubleshooting.
- [User guide](user-guide/) tours the interface.
- [API reference](api/) documents the HTTP API for scripts and agents.
- [FAQ and troubleshooting](faq/) answers common questions.
