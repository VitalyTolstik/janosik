---
title: Self-hosting
description: Run Janosik as a single container image with PostgreSQL and Redis, from a LAN trial to a production install behind HTTPS.
---

The self-host image serves the whole product on one origin: the API under
`/api/v1`, the app (React SPA) under `/app/`, and the marketing site at `/`. No
separate web server is required, and SSE and cookies work on a single origin.

## What the stack runs

`docker compose up -d` starts three containers:

- **`app`** — the site, application, API, master panel and background jobs.
  It listens on port `3000`. Its image is `ghcr.io/vitalytolstik/janosik`;
  `JANOSIK_TAG` selects the version and defaults to `latest`.
- **`postgres`** — the `postgres:16-alpine` database for boards, users,
  commands and the audit log.
- **`redis`** — the `redis:7-alpine` service for background jobs, including
  mail, transcoding, maintenance and exports.

Only the app port is published to the host; `postgres` and `redis` stay
internal. On boot the `app` container applies database migrations, then starts
the API.

The container starts as root only to hand the uploads volume to the
unprivileged `node` user (volumes created by older images belong to root),
then runs migrations, the API and ffmpeg as `node`. Before that it checks two
settings: it refuses to start while `POSTGRES_PASSWORD` is still the example
`change-me`, and it logs a reminder at every start while
`ALLOW_REGISTRATION=true`.

The image sets `STATIC_DIR=/app/public`, `SITE_DIR=/app/site` and
`UI_BASE=/app/`. With those defaults the marketing site is at `/` and the app
is under `/app/`, so the board UI is at `PUBLIC_ORIGIN/app/` and the master
panel is at `PUBLIC_ORIGIN/app/admin`.

## Platforms and installation

Janosik runs in a browser and requires a running server. Use Docker on Linux,
macOS (Intel or Apple Silicon), or Windows with Docker Desktop and WSL2. Docker
downloads the appropriate Linux `amd64` or `arm64` image automatically.
GitHub release archives contain source code; there is no standalone Windows
`.exe` or macOS `.dmg` installer.

Version v0.2.0 was tested on WSL and in Linux CI on both architectures. It has
not been separately tested on a physical Mac. The installer starts a local-only
trial; see the LAN and HTTPS instructions below to reach it from other devices.

## Prerequisites

- A host with Docker Engine 24 or newer and the Docker Compose v2 plugin.
- Port `3210` free for the default local installer; manual LAN examples use
  port `3000`. For a public deployment, use ports `80` and `443` with a
  reverse proxy.
- A domain name for HTTPS (optional for a trial, required for real use).

Check your host:

```bash
docker --version
docker compose version
```

Installing Docker on your own machine is covered in
[Install Docker by operating system](#install-docker-by-operating-system)
below.

## Trial on a LAN or localhost

Good for kicking the tyres. Not for exposing to the internet.

For a trial on Linux, macOS or Windows with WSL2, install Docker, Compose,
curl and OpenSSL, then run:

```bash
curl -fsSLO https://raw.githubusercontent.com/VitalyTolstik/janosik/main/install.sh && bash install.sh
```

Open `http://localhost:3210/app/`. The installer creates `janosik/.env` and
`janosik/docker-compose.yml`, generates unique secrets, and listens only on
localhost. It uses the latest stable GitHub release and its matching image;
both must be published first. To change the directory or port, set
`JANOSIK_INSTALL_DIR` or `JANOSIK_INSTALL_PORT` when running `bash install.sh`.
It refuses to overwrite existing files. After a startup error, correct it and
run `docker compose up -d` in the installation directory.

For a LAN trial or manual configuration:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
```

Edit `.env`:

- `JWT_SECRET`: generate one with `openssl rand -hex 32`.
- `POSTGRES_PASSWORD`: pick a strong password. The container refuses to
  start with the example `change-me`.
- `PUBLIC_ORIGIN=http://<host-ip>:3000` (or `http://localhost:3000`).
- Set `COOKIE_SECURE=false` for this plain-HTTP trial (the safe default is
  `true`; over HTTP the app refuses to boot rather than drop the cookie).

```bash
docker compose up -d
```

Open `http://<host-ip>:3000/app/`. Because this is plain HTTP, the app logs a
loud warning about `COOKIE_SECURE=false`. That is expected here.

## Production with a domain and HTTPS

The difference from the trial is that you stop publishing the app directly and
let a TLS-terminating proxy forward to `localhost:3000`.

### Configure `.env`

```
JWT_SECRET=<openssl rand -hex 32>
POSTGRES_USER=janosik
POSTGRES_PASSWORD=<strong password>
POSTGRES_DB=janosik
PUBLIC_ORIGIN=https://kanban.example.com
COOKIE_SECURE=true
TRUST_PROXY=1
APP_BIND_ADDRESS=127.0.0.1
ALLOW_REGISTRATION=true
```

`PUBLIC_ORIGIN` must match the URL users actually open. It sets the built-in
site's canonical, social preview and sitemap URLs, builds OAuth callback URLs,
and drives the Secure-cookie check.
If converting an installer-created trial, keep its secrets and
`COMPOSE_PROJECT_NAME`. The installer sets `PORT=3210`; either change it to
`3000` for the examples below or configure the proxy for `127.0.0.1:3210`.

### Start the stack

```bash
docker compose up -d
```

The app is now on `localhost:3000`, reachable only from the host.

### Put TLS in front

**Caddy** provisions a Let's Encrypt certificate automatically:

```text
# /etc/caddy/Caddyfile
kanban.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**nginx** terminates TLS and proxies everything to the app. Realtime works
without extra tuning because the API sends `X-Accel-Buffering: no`, but turning
buffering off explicitly is harmless and makes the intent clear. Raise
`client_max_body_size`: nginx refuses bodies over 1 MB by default, which would
break attachments (up to 25 MB), board imports (25 MB), command/plan bodies
(10 MB) and large commands (2 MB) with a `413`.

```nginx
server {
    listen 443 ssl;
    server_name kanban.example.com;

    # ssl_certificate     /etc/letsencrypt/live/kanban.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/kanban.example.com/privkey.pem;

    client_max_body_size 30m;         # attachments, imports, commands

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # realtime (SSE)
        proxy_read_timeout 3600s;     # keep long-lived streams open
    }
}
```

**Traefik** works the same way: forward to `127.0.0.1:3000`, pass
`X-Forwarded-For` and `X-Forwarded-Proto`, and set `TRUST_PROXY=1` so rate
limits and the audit log see the real client IP instead of the proxy's. A
minimal file-provider config:

```yaml
# traefik dynamic configuration (file provider)
http:
  routers:
    janosik:
      rule: "Host(`kanban.example.com`)"
      entryPoints: [websecure]
      service: janosik
      tls:
        certResolver: letsencrypt
  services:
    janosik:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3000"
```

### Firewall

Only the proxy ports (`80`, `443`) should be open. The app port `3000` and the
database and Redis ports stay internal.

## First run

1. **Create a master account.** The CLI creates a separate account for the
   master panel. The first master becomes `OWNER`.

   ```bash
   docker compose exec app node /app/backend/scripts/admin-cli.cjs create --email me@example.com
   # Enter the password twice at the hidden prompt.
   docker compose exec app node /app/backend/scripts/admin-cli.cjs list
   ```

   Sign in at `PUBLIC_ORIGIN/app/admin`. To reset a master's password and revoke
   its sessions, run:

   ```bash
   docker compose exec app node /app/backend/scripts/admin-cli.cjs passwd --email me@example.com
   ```

2. **Create your board account.** With the default Compose settings and no
   SMTP, self-service password registration is unavailable. In the master
   panel, choose **Users → Create user**, then open the user's details and
   choose **Verify email** for an address you control. Sign in to
   `PUBLIC_ORIGIN/app/` with the user's password.

   - For self-service signup, configure SMTP under **Settings → Email**
     (`/app/admin/settings?tab=email`) and keep registration open. Then use
     **Create account** at `PUBLIC_ORIGIN/app/` and verify your email.
   - The local installer enables `ALLOW_BOOTSTRAP_USER=true` with open
     registration. On an empty database, **Create account** creates and
     verifies one board account without SMTP. Set `ALLOW_BOOTSTRAP_USER=false`
     in `.env` after that account is created.

3. **Close registration for a private instance.** Set
   `ALLOW_REGISTRATION=false` in `.env` and run `docker compose up -d`.
   A value saved under **Settings → General → Feature flags → Open registration**
   takes precedence. Check `/api/v1/auth/config` for `allowRegistration: false`.

The CLI accepts three commands: `create`, `passwd` and `list`. Passwords are 8
to 100 characters and are never passed on the command line. Interactive runs
prompt twice with hidden input; non-interactive runs read the `ADMIN_PASSWORD`
environment variable instead.

### Connect MCP

The Compose stack already provides the API used by MCP. Create a personal key
under **Account → API keys**, then configure the MCP client on the agent's
machine as described in [MCP and agents](/docs/mcp/). For this local trial use
`JANOSIK_URL=http://localhost:3210` and `JANOSIK_APP_BASE=/app`. The MCP
process needs Node.js and network access to that URL; on another machine or in
a container, use a reachable HTTPS origin instead of `localhost`.

## Email (optional)

Without SMTP no mail is sent and password registration is unavailable, except for the one-time `ALLOW_BOOTSTRAP_USER` first account. Configure email before opening registration. Accounts created under the former automatic-verification policy require operator review. To link OAuth to an existing password account, sign in and use Account → Security with a provider using the same email address.
Production logs omit message contents, including codes.

To send real mail, open the master panel, go to **Email service**, pick a
preset (Gmail, Yandex, Mail.ru, Brevo, SendGrid or custom SMTP), paste the
credentials and enable delivery. Gmail, Yandex and Mail.ru need an app
password with 2-step verification on, not your login password.

## Environment reference

Every variable is validated at boot by `backend/src/config/env.ts`. The
compose stack fills the ones it needs from `.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | One of `development`, `test`, `production`. The image sets `production`. |
| `PORT` | `3000` | HTTP port the API listens on. The container always listens on `3000`; compose publishes it. |
| `DATABASE_URL` | none (required) | PostgreSQL connection string used by Prisma. Compose builds it from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`. |
| `TEST_DATABASE_URL` | empty | Used instead of `DATABASE_URL` when `NODE_ENV=test`, so e2e runs never touch the dev database. |
| `JWT_SECRET` | none (required) | Signs access tokens. At least 32 characters. Generate with `openssl rand -hex 32`. |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime, a vercel/ms duration string. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh-token lifetime in days. |
| `THROTTLE_LIMIT` | `300` | Global API rate limit, requests per minute per principal: the user, the API key, or the IP for anonymous calls. |
| `AGENT_SESSION_RATE_LIMIT` | `0` (auto) | Per-agent-session weighted units per minute (a batch costs its command count). `0` = `max(600, THROTTLE_LIMIT)`; otherwise at least `100`. |
| `AGENT_TOKEN_RATE_LIMIT` | `0` (auto) | Per-API-key agent weighted units per minute. `0` = `max(600, ceil(THROTTLE_LIMIT / 4))`; an explicit token `rateLimitPerMinute` is capped at this share. Pinned values are at least `100`. |
| `BOARD_RATE_LIMIT` | `0` (auto) | Per-board agent weighted-units safety ceiling shared by all agents on the board. `0` = `max(12000, 2 × THROTTLE_LIMIT)`. Size it for a larger swarm; token and session buckets provide fairness. Pinned values are at least `100`. |
| `AGENT_COMMAND_QUEUE_MS` | `1500` | How long a command over the board ceiling waits for enough tokens/queue capacity before `503` + `Retry-After`; `X-RateLimit-Queued-Ms` reports the total wait (`0` when the 64-queued-request/32-MiB serialized-JSON queue cap rejects immediately). Maximum `30000`. `0` answers immediately. |
| `BOARD_READ_CAP` / `BOARD_READ_QUEUE_MAX` | `16` / `256` | Full `GET /boards/:id` builds running at once **per API process** / waiting for a slot. Identical concurrent reads coalesce first; only distinct board/role/projection/content-coding groups compete. With N replicas the cluster cap is N × this value. The cap may exceed `DB_CONNECTION_LIMIT` (default 10): extra builds wait on the Prisma pool up to `BOARD_READ_WAIT_MS`, then answer `503 board_read_busy`. Set the cap at or below the pool to avoid pool waits. |
| `BOARD_READ_WAIT_MS` / `BOARD_READ_TIMEOUT_MS` | `10000` / `20000` | Maximum queue/pool wait / total response time (wait + build + encode) for one board read before `503 board_read_busy`/`board_read_timeout`. The timeout must exceed the wait. The read transaction gets `maxWait=WAIT_MS` and `timeout=TIMEOUT_MS−250`; P2024/P2028 become 503, not 500. A query already sent is not cancelled but expires by that budget. |
| `BOARD_READ_RETRY_AFTER_SECONDS` | `2` | `Retry-After` advertised when a full board read is refused. |
| `BOARD_READ_COMPRESS_MIN_BYTES` | `1024` | Bodies below this stay uncompressed on `GET /boards/:id`; larger ones negotiate gzip/Brotli and always send `Vary: Accept-Encoding`. |
| `TRUST_PROXY` | `0` | Trusted reverse-proxy hops. Set `1` behind one proxy. |
| `UPLOAD_DIR` | empty | Blob root for attachments and avatars. Empty means `backend/data/uploads`; a relative value anchors to the backend package, never the process working directory. |
| `STATIC_DIR` | empty | Built UI directory. Empty means API only. The image sets `/app/public`. Inline scripts here are allowed by CSP hashes computed at startup, so restart the API after rebuilding the UI. |
| `SITE_DIR` | empty | Built marketing site directory served at `/`. Empty means not served. The image sets `/app/site`. |
| `UI_BASE` | `/` | Sub-path the app is served from, used for OAuth redirects. The image sets `/app/`. |
| `ALLOW_PUBLIC_SHARES` | `true` | Master switch for public read-only share links. `false` also blocks creating new links (and the Share dialog hides), not only token resolution; the public share API answers `404`. |
| `ALLOW_REGISTRATION` | `true` | Allow password sign-up when SMTP or one-time bootstrap is available. Set `false` for a private instance. The container logs a warning at start while it is `true`. |
| `ALLOW_BOOTSTRAP_USER` | `false` | One-time bootstrap without SMTP: allows exactly the first account and auto-verifies it. Inert once a user exists; set `false` after setup. The local installer enables it. |
| `COOKIE_SECURE` | `true` (compose default) | Force the `Secure` cookie attribute. Keep `true` behind HTTPS; set `false` only for a plain-HTTP trial (the app then refuses to boot with it on). Choices are empty (auto: on in production), `true`, `false`. |
| `PURGE_AFTER_DAYS` | `30` | Delete soft-deleted rows older than this many days. Used when the panel has no retention setting. |
| `UNVERIFIED_ACCOUNT_TTL_DAYS` | `14` | Release the unique e-mail address of an abandoned, never-verified registration after this many days. The sweep skips accounts that accepted a board membership or wrote content. |
| `MAX_BOARDS_PER_USER` | `0` | Server-mode board cap per account. `0` = unlimited (the product default); a positive value is an operator safety cap. Local/offline mode keeps its own 10-board localStorage guard. |
| `AUDIT_RETENTION_DAYS` | `365` | Delete master audit-log rows older than this many days (accountability keeps a longer window). |
| `DB_CONNECTION_LIMIT` | `10` | Prisma pool size per API process. Keep `replicas × this` under `POSTGRES_MAX_CONNECTIONS`. |
| `SLOW_QUERY_MS` | `200` | Prisma queries at or above this duration are logged with the request id. `0` disables it. |
| `NODE_OPTIONS` | `--max-old-space-size=1024` | Node heap ceiling for the API process. Bounds memory so a live-stream surge triggers GC instead of the container OOM-killer. Raise it on a bigger host. |
| `SHARE_AGGREGATE_CACHE_MS` | `2000` | Live-share aggregate cache window. Each process stores up to 64 board aggregates by count and evicts the least recently used at capacity. Memory depends on board size. A changed board `seq` invalidates the entry. `0` disables storage. Up to 64 distinct rebuilds can run concurrently per process. A new rebuild at capacity returns `503`. |
| `ADMIN_METRICS_CACHE_MS` | `5000` | Master `/api/v1/admin/metrics` cache window (dropped on any moderation action). `0` disables. |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | `shared_buffers` of the bundled Postgres container. |
| `POSTGRES_WORK_MEM` | `8MB` | `work_mem` of the bundled Postgres container. |
| `POSTGRES_MAX_CONNECTIONS` | `100` | `max_connections` of the bundled Postgres container. |
| `SHARE_RATE_LIMIT` | `240` | Public share requests per minute, per token. |
| `SHARE_OG_RATE_LIMIT` | `60` | Public share OG preview requests per minute, per token. |
| `SMTP_HOST` | empty | SMTP host. Unset means emails are not sent; production logs omit their contents. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | `false` | Implicit TLS. Use `true` for port 465. |
| `SMTP_USER` | empty | SMTP user. |
| `SMTP_PASS` | empty | SMTP password. |
| `SMTP_FROM` | `Janosik <no-reply@janosik.local>` | From header for outgoing mail. |
| `REDIS_URL` | empty | Redis URL for BullMQ queues, realtime fan-out across nodes, and the shared rate-limit and login-backoff counters. Unset means the in-process queue and per-process counters. |
| `QUEUES_DASHBOARD` | `false` | Mount the Bull Board queue dashboard at `/api/v1/admin/queues`. Owner only. |
| `SETTINGS_SECRET` | empty | Encrypts credentials saved from the master panel. Derived from `JWT_SECRET` when unset. |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | Public base URL of the UI. Builds OAuth callback URLs. Compose defaults it to `http://localhost:3000`. |

The compose file also reads variables that the API does not validate:

| Variable | Default | Notes |
| --- | --- | --- |
| `POSTGRES_USER` | `janosik` in `.env.example` | Database user, created on first `up`. |
| `POSTGRES_PASSWORD` | `change-me` in `.env.example` (required) | Database password. Pick a strong one: the container refuses to start while it is `change-me`. |
| `POSTGRES_DB` | `janosik` in `.env.example` | Database name. |
| `JANOSIK_TAG` | `latest` | Image tag to run, for example `v0.2.0`. |

OAuth login (Google and Yandex) is configured in the master panel, not in
`.env`.

## Install Docker by operating system

Two ways to run Janosik on your own machine:

| | Docker (recommended) | From source (development) |
| --- | --- | --- |
| What it is | Prebuilt container: whole app plus PostgreSQL and Redis | UI and API development servers with PostgreSQL |
| You need | Docker Desktop or Docker Engine | Node.js 22.17 or newer, npm |
| Best for | Running Janosik, including self-hosting | Developing Janosik |

### macOS

Install and start Docker Desktop (Intel or Apple Silicon), or use Colima with
Docker and Compose. In Terminal, follow the [local installer](#trial-on-a-lan-or-localhost).
The published image supports both `amd64` and `arm64`.

### Windows 11

1. Install WSL2 and a Linux distribution (for example Ubuntu) from an
   administrator PowerShell using `wsl --install`. Restart if prompted.
2. Install and start Docker Desktop. Enable its WSL2 engine and WSL integration
   for your distribution.
3. Open the Ubuntu terminal, ensure `curl` and `openssl` are installed, and run
   the [local installer](#trial-on-a-lan-or-localhost) there. Keep the install
   directory inside the WSL filesystem (for example `~/janosik`).

The installer is a Bash script; do not run it directly in PowerShell.

### Linux

Install and start Docker Engine and the Compose v2 plugin. Make sure your user
can run Docker, and install `curl` and OpenSSL. Then run the
[local installer](#trial-on-a-lan-or-localhost). Docker's official installation
instructions for your distribution are at [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).

### From source, all platforms

Install Node.js 22.17 or newer (the repository selects major version **24** in
`.nvmrc`) and run `npm install` at the repository root. Configure the API
**first** — the dev
compose file reads `POSTGRES_*` from `backend/.env`, so that file must exist
before `docker compose up`:

```bash
# 1. configure the API
cp backend/.env.example backend/.env
#   set JWT_SECRET (openssl rand -hex 32; on PowerShell see the Windows section)

# 2. dev PostgreSQL (container janosik-postgres on port 5433)
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d

# 3. migrate, build and start the API (port 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. in a second terminal, start the UI (Vite proxies /api to :3000)
npm run dev
```

With the default `backend/.env.example` configuration (no SMTP or bootstrap),
self-service password registration is unavailable. From the repository root
run `npm run admin:create -w backend -- --email me@example.com` to create the
first master. Sign in at `http://localhost:5173/admin` (the Vite dev URL), go to
**Users → Create user**, and open the user's details to **Verify email** for
an address you control. Then sign in with the board account at
`http://localhost:5173/`.

The **marketing site** is a separate dev server (`npm run dev:site`, port 4321).
In dev the app is not served under `/app/` on the site — that path belongs to the
self-host image — so point its CTAs at the UI dev server:
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`.

**Outgoing email is off by default** (log mode unless `SMTP_*` is set); password
registration requires configured email. See [Email service](/docs/admin/settings/)
and [Runbooks](/docs/runbooks/). A local sandbox is Mailpit:

```bash
docker run -d --name janosik-mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
# SMTP localhost:1025, web inbox http://localhost:8025
```

To build the image from a checkout instead of pulling, uncomment `build: .` in
`docker-compose.yml`.

## Split deployment (app and site on different hosts)

The self-host image is a **single origin** — the site at `/`, the app at `/app/`
— so nothing needs configuring. If you serve the **app** and the **marketing
site/docs** from *different* hosts, wire the two links that cross between them:

| Direction | Variable | Set on | Value |
| --- | --- | --- | --- |
| Site → App ("Sign in" / "Create account" CTAs) | `PUBLIC_APP_URL` | the **site** build | the app origin, e.g. `https://app.example.com/` |
| App → Site ("Help → Documentation") | `VITE_SITE_URL` | the **UI** build | the site origin, with a trailing slash, e.g. `https://example.com/` |

If either value is wrong, the link opens a **404**: a CTA opens the site's
not-found page, or Help → Documentation opens the app's not-found page. This
is the same pair you set in dev, where the app and the site are always two
servers (app `:5173`, site `:4321`):

```bash
# UI dev server — the in-app Help menu points at the Astro dev site:
VITE_SITE_URL=http://localhost:4321/ npm run dev

# site dev server — the Sign in / Create account CTAs point at the UI:
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

### Serve the frontends with nginx

The included `deploy/nginx.conf` is for deployments where nginx serves both
static builds itself. Build the site with its public origin because nginx cannot
rewrite canonical URLs, Open Graph URLs or sitemaps at runtime. For a site under
`/janosik/`, use `SITE_BASE=/janosik/ SITE_URL=https://public-host PUBLIC_APP_URL=/app/ npm run build -w site`
and mount the output under `/janosik/`. Copy the built `404.html` to nginx's
document root for the sample fallback. Keep `PUBLIC_APP_URL=/app/` for an app on
the same origin at `/app/`, or use the full public URL of your app.
`SITE_BASE` prefixes generated navigation, assets and SEO URLs. Root-relative
links authored in the docs body still resolve from the origin root. Serve those
paths there or use a root site build if every inline docs link must work without
extra routing.

Generate the CSP include from the exact app and site builds you serve, after
building the backend and both frontends. Regenerate it
on each frontend rebuild. The include is required. A missing file makes
`nginx -t` fail. Reload nginx after the configuration check passes.

```bash
node scripts/generate-nginx-csp.mjs ui/dist site/dist > /etc/nginx/janosik-csp.conf.next &&
  mv /etc/nginx/janosik-csp.conf.next /etc/nginx/janosik-csp.conf &&
  nginx -t
```

The include uses the same inline-script hashes and policy as the Node server.
Public share pages retain their framing policy. The sample sets HSTS on static
responses and forwards API security headers from Node. For responses generated
by nginx itself, including API 413 and 502 errors, nginx supplies HSTS and a
restrictive CSP. Serve the public hostname over HTTPS to apply HSTS in browsers.

## Data locations

| Data | Where |
| --- | --- |
| Database | Docker volume `janosik-pgdata` |
| Redis | Docker volume `janosik-redisdata` |
| Attachments and avatars | Docker volume `janosik-uploads` |
| Configuration | `.env` next to `docker-compose.yml` |

Backups, restores and upgrades live in
[Operations runbooks](/docs/runbooks/). Report vulnerabilities privately; see
[Security](/docs/security/).
