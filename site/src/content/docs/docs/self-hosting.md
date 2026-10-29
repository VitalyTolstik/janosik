---
title: Self-hosting
description: Run Janosik as a single container image with PostgreSQL and Redis, from a LAN trial to a production install behind HTTPS.
---

The self-host image serves the whole product on one origin: the API under
`/api/v1`, the app (React SPA) under `/app/`, and the marketing site at `/`. No
separate web server is required, and SSE and cookies work on a single origin.

## What the stack runs

`docker compose up -d` starts three containers:

| Service | Image | Role |
| --- | --- | --- |
| `app` | `ghcr.io/vitalytolstik/janosik:${JANOSIK_TAG:-latest}` | The whole application: the NestJS API under `/api/v1`, the built SPA under `/app/`, the master panel, and background jobs. Listens on port `3000`. |
| `postgres` | `postgres:16-alpine` | The database: boards, users, command log, audit. |
| `redis` | `redis:7-alpine` | Job queues (mail, transcoding, maintenance, exports). |

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

## Prerequisites

- A host with Docker Engine 24 or newer and the Docker Compose v2 plugin.
- Port `3000` reachable for the LAN trial, or `80` and `443` if you put a
  reverse proxy in front (recommended for production).
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
ALLOW_REGISTRATION=true
```

`PUBLIC_ORIGIN` must match the URL users actually open. It builds OAuth
callback URLs and drives the Secure-cookie check.

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
break attachments (up to 25 MB), board imports (5 MB) and large commands
(2 MB) with a `413`.

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

1. **Create your account.** Open `PUBLIC_ORIGIN/app/` and click
   **Create account**. The first account is a normal user. There is no
   auto-admin.
2. **Close registration.** Set `ALLOW_REGISTRATION=false` in `.env` and run
   `docker compose up -d`. You can also toggle **Feature flags → Open
   registration** in the master panel later. The sign-in screen then hides the
   register form.
3. **Create a master (platform admin).** The panel at `/admin` belongs to a
   master account, which lives outside the user table and can only be created
   by the CLI. There is deliberately no HTTP endpoint for it:

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
   # hidden password prompt (typed twice); the first master becomes OWNER
   docker compose exec app node backend/scripts/admin-cli.cjs list
   ```

   Sign in to the master panel at `PUBLIC_ORIGIN/app/admin`.

   Re-key an existing master (this also revokes its sessions and clears any
   lockout):

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs passwd --email me@example.com
   ```

The CLI accepts three commands: `create`, `passwd` and `list`. Passwords are 8
to 100 characters and are never passed on the command line. Interactive runs
prompt twice with hidden input; non-interactive runs read the `ADMIN_PASSWORD`
environment variable instead.

## Email (optional)

Out of the box the app runs in log mode. No mail is sent, and verification
codes are printed to `docker compose logs app`. That is fine for a
single-user install.

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
| `TRUST_PROXY` | `0` | Trusted reverse-proxy hops. Set `1` behind one proxy. |
| `UPLOAD_DIR` | empty | Blob root for attachments and avatars. Empty means `backend/data/uploads`; a relative value anchors to the backend package, never the process working directory. |
| `STATIC_DIR` | empty | Built UI directory. Empty means API only. The image sets `/app/public`. Inline scripts here are allowed by CSP hashes computed at startup, so restart the API after rebuilding the UI. |
| `SITE_DIR` | empty | Built marketing site directory served at `/`. Empty means not served. The image sets `/app/site`. |
| `UI_BASE` | `/` | Sub-path the app is served from, used for OAuth redirects. The image sets `/app/`. |
| `ALLOW_PUBLIC_SHARES` | `true` | Master switch for public read-only share links. `false` makes the whole share contour answer `404`. |
| `ALLOW_REGISTRATION` | `true` | Open sign-up. Set `false` after your account exists. The container logs a warning at start while it is `true`. |
| `COOKIE_SECURE` | `true` (compose default) | Force the `Secure` cookie attribute. Keep `true` behind HTTPS; set `false` only for a plain-HTTP trial (the app then refuses to boot with it on). Choices are empty (auto: on in production), `true`, `false`. |
| `PURGE_AFTER_DAYS` | `30` | Delete soft-deleted rows older than this many days. Used when the panel has no retention setting. |
| `AUDIT_RETENTION_DAYS` | `365` | Delete master audit-log rows older than this many days (accountability keeps a longer window). |
| `DB_CONNECTION_LIMIT` | `10` | Prisma pool size per API process. Keep `replicas × this` under `POSTGRES_MAX_CONNECTIONS`. |
| `SLOW_QUERY_MS` | `200` | Prisma queries at or above this duration are logged with the request id. `0` disables it. |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | `shared_buffers` of the bundled Postgres container. |
| `POSTGRES_WORK_MEM` | `8MB` | `work_mem` of the bundled Postgres container. |
| `POSTGRES_MAX_CONNECTIONS` | `100` | `max_connections` of the bundled Postgres container. |
| `SHARE_RATE_LIMIT` | `240` | Public share requests per minute, per token. |
| `SHARE_OG_RATE_LIMIT` | `60` | Public share OG preview requests per minute, per token. |
| `SMTP_HOST` | empty | SMTP host. Unset means emails are written to the log, never sent. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | `false` | Implicit TLS. Use `true` for port 465. |
| `SMTP_USER` | empty | SMTP user. |
| `SMTP_PASS` | empty | SMTP password. |
| `SMTP_FROM` | `Janosik <no-reply@janosik.local>` | From header for outgoing mail. |
| `REDIS_URL` | empty | Redis URL for BullMQ queues, realtime fan-out across nodes, and the shared rate-limit and login-backoff counters. Unset means the in-process queue and per-process counters. |
| `QUEUES_DASHBOARD` | `false` | Mount the Bull Board queue dashboard at `/admin/queues`. Owner only. |
| `SETTINGS_SECRET` | empty | Encrypts credentials saved from the master panel. Derived from `JWT_SECRET` when unset. |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | Public base URL of the UI. Builds OAuth callback URLs. Compose defaults it to `http://localhost:3000`. |

The compose file also reads variables that the API does not validate:

| Variable | Default | Notes |
| --- | --- | --- |
| `POSTGRES_USER` | `janosik` in `.env.example` | Database user, created on first `up`. |
| `POSTGRES_PASSWORD` | `change-me` in `.env.example` (required) | Database password. Pick a strong one: the container refuses to start while it is `change-me`. |
| `POSTGRES_DB` | `janosik` in `.env.example` | Database name. |
| `JANOSIK_TAG` | `latest` | Image tag to run, for example `v0.1.0`. |

OAuth login (Google and Yandex) is configured in the master panel, not in
`.env`.

## Install Docker by operating system

Two ways to run Janosik on your own machine:

| | Docker (recommended) | From source (development) |
| --- | --- | --- |
| What it is | Prebuilt container: whole app plus PostgreSQL and Redis | Node dev server, optionally with a local API |
| You need | Docker Desktop or Docker Engine | Node.js 22.17 or newer, npm |
| Best for | Actually using it, self-hosting | Changing the code |

### macOS

Install Docker Desktop (Apple Silicon or Intel), or Colima for a lighter
CLI-only setup:

```bash
brew install --cask docker          # Docker Desktop
# or, no GUI:
brew install colima docker docker-compose && colima start
```

Launch Docker Desktop once and wait until it says it is running. Then:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # copy into JWT_SECRET in .env
# edit .env: JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN=http://localhost:3000
docker compose up -d
```

Open `http://localhost:3000/app/`, create your account, then create a master:

```bash
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

The published image is built for both `arm64` and `amd64`, so Apple Silicon
runs it natively. A local `docker build` also works: `ffmpeg-static` and Prisma
both ship arm64 binaries.

### Windows 11

Docker on Windows runs through WSL2, so the smoothest experience is to work
inside a WSL2 Linux shell. Native PowerShell works too.

One-time setup:

1. Install WSL2 and a distro (Ubuntu) from an admin PowerShell:

   ```powershell
   wsl --install
   ```

   Reboot if asked, then set a Linux username and password.

2. Install Docker Desktop for Windows and enable **Use the WSL 2 based
   engine** plus **WSL integration** for your Ubuntu distro. Keep Docker
   Desktop running.

Option A, in WSL2 (recommended). Open Ubuntu and follow the Linux commands.
`curl` and `openssl` are present:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # JWT_SECRET
docker compose up -d
```

Option B, in PowerShell. `curl` ships with Windows 11 as `curl.exe`, but
`openssl` does not, so generate the secret like this instead:

```powershell
mkdir janosik; cd janosik
curl.exe -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl.exe -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
# JWT_SECRET value (64 hex chars):
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
notepad .env                    # paste it into JWT_SECRET, set POSTGRES_PASSWORD
docker compose up -d
```

Open `http://localhost:3000/app/` in your browser and create the master the
same way from either shell:

```powershell
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

Tips: keep the project inside the WSL filesystem (for example `~/janosik`),
not under `/mnt/c/…`, because file I/O across the Windows and Linux boundary is
slow. If `docker` is not found in WSL, enable WSL integration for your distro
in Docker Desktop. Save `.env` as UTF-8 without BOM and with LF line endings;
the template already does.

### Linux

Install Docker Engine and the Compose plugin. The official convenience script
is the quickest:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out and back in
```

Or use your distro's packages (Debian and Ubuntu):

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Run the stack (no `sudo` needed after re-login):

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # JWT_SECRET
nano .env                       # JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN
docker compose up -d
```

Open `http://localhost:3000/app/`, create your account and a master:

```bash
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

For a public server, add TLS and set `COOKIE_SECURE=true` plus `TRUST_PROXY=1`.
Open the firewall only for `80` and `443` (`sudo ufw allow 80,443/tcp`).

### From source, all platforms

Once Node 22.17 or newer (the repo pins **24** in `.nvmrc`) is installed and
`npm install` has run at the repo root. Configure the API **first** — the dev
compose file reads `POSTGRES_*` from `backend/.env`, so that file must exist
before `docker compose up`:

```bash
# 1. configure the API
cp backend/.env.example backend/.env
#   set JWT_SECRET (openssl rand -hex 32; on PowerShell see the Windows section)

# 2. dev PostgreSQL (container janosik-postgres on port 5433)
docker compose -f backend/docker-compose.yml up -d

# 3. migrate, build and start the API (port 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. in a second terminal, start the UI (Vite proxies /api to :3000)
npm run dev
```

The dev UI is **always in server mode**: `npm run dev` shows a **sign-in screen**
and needs the API above — there is no "no-login demo board" dev run. Register at
`http://localhost:5173` (registration is open by default), create a master with
`npm run admin:create -w backend -- --email me@example.com`, and open `/admin`.

The **marketing site** is a separate dev server (`npm run dev:site`, port 4321).
In dev the app is not served under `/app/` on the site — that path belongs to the
self-host image — so point its CTAs at the UI dev server:
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`.

**Outgoing email is off by default** (log mode unless `SMTP_*` is set): codes go
to the server log, nothing is emailed. See [Email service](/docs/admin/settings/)
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

Getting either wrong lands the user on a **404**: a CTA that opens the site's
not-found page, or Help → Documentation that opens the app's not-found page. This
is the same pair you set in dev, where the app and the site are always two
servers (app `:5173`, site `:4321`):

```bash
# UI dev server — the in-app Help menu points at the Astro dev site:
VITE_SITE_URL=http://localhost:4321/ npm run dev

# site dev server — the Sign in / Create account CTAs point at the UI:
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site
```

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
