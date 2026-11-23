# Self-hosting Janosik

Janosik ships as a single container image that serves **both** the API and the
built frontend on one origin — no separate web server to wire up, no proxy
config for realtime. This guide covers a local trial, a production install with
HTTPS, day-2 operations (upgrades, backups) and troubleshooting.

> Short version is in the [README](../README.md#self-hosting-with-docker);
> this is the full one.

---

## What you get

`docker compose up -d` starts three containers:

| Service | Image | Role |
| --- | --- | --- |
| `app` | `ghcr.io/vitalytolstik/janosik` | The whole application: NestJS API under `/api/v1`, the built SPA, the master panel at `/app/admin`, background jobs. Serves on port `3000`. |
| `postgres` | `postgres:16-alpine` | The database (boards, users, command log, audit). |
| `redis` | `redis:7-alpine` | Job queues (mail, video transcoding, maintenance, exports). |

`postgres` and `redis` are **not** published to the host — only the app port
is exposed. On boot the `app` container applies database migrations, then
starts the API.

This is the complete install for one host. To run 2–4 API replicas behind the
bundled nginx/Caddy proxy, see the scaling section below; the overlay is
optional and the single-container quick start above is unchanged.

---

The application runs in a browser and requires a running server. Docker is
available on Linux, macOS (Intel and Apple Silicon), and Windows with Docker
Desktop and WSL2. The registry provides Linux `amd64` and `arm64` images;
GitHub release archives contain source code, not installers. There are no
standalone `.exe` or `.dmg` installers. Version v0.2.0 was tested on WSL and
in Linux CI on both architectures; it has not been separately tested on a
physical Mac.

## Prerequisites

- A host with **Docker Engine 24+** and the **Docker Compose v2** plugin.
  (Installing Docker on your own macOS / Windows 11 / Linux machine —
  including WSL2 on Windows — is covered in
  [INSTALL-BY-OS.md](./INSTALL-BY-OS.md).)
- Port **3000** reachable (for the LAN trial), or **80/443** if you put a
  reverse proxy in front (recommended for production).
- A domain name for HTTPS (optional for a trial, required for real use).

Check your host:

```bash
docker --version
docker compose version
```

---

## 1. Trial on a LAN / localhost (plain HTTP)

Use this for a local trial. Do not expose this HTTP setup to the internet.

For a localhost-only trial on Linux, macOS, or WSL with Docker, Compose, curl
and OpenSSL installed, the installer generates the secrets and starts the stack:

```bash
curl -fsSLO https://raw.githubusercontent.com/VitalyTolstik/janosik/main/install.sh && bash install.sh
```

Open `http://localhost:3210/app/`. The installer creates `janosik/.env` and
`janosik/docker-compose.yml` and refuses to overwrite either file. Set
`JANOSIK_INSTALL_DIR` or `JANOSIK_INSTALL_PORT` before invoking it to choose
another directory or port. If startup fails, fix the reported error and run
`docker compose up -d` from that directory. The installer pins the image and
Compose file to the latest stable GitHub release. A published release and its
public image are required.

For a LAN trial, or to configure the stack manually:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
```

Edit `.env`:

- `JWT_SECRET` — generate one: `openssl rand -hex 32`
- `POSTGRES_PASSWORD` — pick a strong password
- `PUBLIC_ORIGIN=http://<host-ip>:3000` (or `http://localhost:3000`)
- set `COOKIE_SECURE=false` for this plain-HTTP trial (the safe default is
  `true`; over HTTP the app refuses to boot rather than drop the cookie)

```bash
docker compose up -d
```

Open `http://<host-ip>:3000/app/`. Because this is plain HTTP, the app logs a loud
warning about `COOKIE_SECURE=false` — that is expected here.

---

## 2. Production with a domain and HTTPS

The difference from the trial is: you stop publishing the app directly and let
a TLS-terminating proxy forward to `localhost:3000`.

### 2.1 Configure `.env`

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

`PUBLIC_ORIGIN` must match the URL users actually open — it sets the built-in
site's canonical, social preview and sitemap URLs and builds OAuth
callback URLs and drives the Secure-cookie check.
If converting an installer-created trial, retain its existing secrets and
`COMPOSE_PROJECT_NAME`. It uses `PORT=3210`; either change `PORT` to `3000`
for the proxy examples below or point the proxy to `127.0.0.1:3210`.

### 2.2 Start the stack

```bash
docker compose up -d
```

With `APP_BIND_ADDRESS=127.0.0.1`, the app is reachable only from the host.
Without it, Compose publishes the port on all host interfaces.

### 2.3 Put TLS in front

**Caddy** — provisions a Let's Encrypt certificate automatically:

```caddyfile
# /etc/caddy/Caddyfile
kanban.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**nginx** — terminate TLS and proxy everything to the app. The API sends
`X-Accel-Buffering: no`, but realtime still has one proxy requirement: turn
buffering off and set `proxy_read_timeout` above the 60 s PAT keep-alive
(`3600s` is safe). No other tuning is needed:

```nginx
server {
    listen 443 ssl;
    server_name kanban.example.com;

    # ssl_certificate     /etc/letsencrypt/live/kanban.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/kanban.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # realtime (SSE)
        proxy_read_timeout 3600s;     # keep long-lived streams open; must exceed the 60 s PAT keep-alive
    }
}
```

**Traefik** and others work the same way: forward to `127.0.0.1:3000`, pass
`X-Forwarded-For`/`X-Forwarded-Proto`, and set `TRUST_PROXY=1` so rate limits
and the audit log see the real client IP instead of the proxy's.

### 2.4 Firewall

Only the proxy ports (`80`, `443`) should be open. The app port `3000` and the
database/Redis ports stay internal.

---

## 3. First run: account, registration, master panel

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

### Connect an MCP client

MCP runs as a separate local process inside your AI client's environment; the
Compose stack already exposes the API it needs. In Janosik, create a personal
key under **Account → API keys**, then configure your MCP client, for example:

```json
{
  "mcpServers": {
    "janosik": {
      "command": "npx",
      "args": ["-y", "@janosik/mcp"],
      "env": {
        "JANOSIK_URL": "http://localhost:3210",
        "JANOSIK_APP_BASE": "/app",
        "JANOSIK_TOKEN": "jnk_your_personal_key"
      }
    }
  }
}
```

The MCP host needs Node.js and network access to the Janosik URL. If it runs
on another machine or in a container, its `localhost` refers to that machine
or container; use a reachable HTTPS origin instead. Use a separate scoped key
per agent. See [the MCP guide](../mcp/README.md) for client configuration and
optional toolsets.

---

## 4. Environment reference

Every variable is documented in [`.env.example`](../.env.example). The ones
that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `JWT_SECRET` | — (**required**) | Access-token signing key. Generate it with `openssl rand -hex 32`. Changing it invalidates all current sessions. |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Public URL. Builds OAuth callbacks; must be `https://…` for `COOKIE_SECURE=true`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `janosik` / — / `janosik` | Database credentials (created on first `up`). |
| `COOKIE_SECURE` | `true` (compose default) | `Secure` flag on the refresh cookie. Keep `true` behind HTTPS; set `false` only for a plain-HTTP trial. A production install served over HTTP with it unset/`true` **refuses to boot**. |
| `ALLOW_REGISTRATION` | `true` | Allow password sign-up when SMTP or one-time bootstrap is available. Set `false` for a private instance. |
| `ALLOW_BOOTSTRAP_USER` | `false` | One-time bootstrap without SMTP: allows exactly the first account and auto-verifies it. Inert once a user exists; set `false` after setup. The local installer enables it. |
| `TRUST_PROXY` | `0` | Number of trusted proxy hops. Set `1` behind one reverse proxy. `.env.example` leaves it unset so the scale overlay can default to `1`; set `2` when an external TLS proxy also fronts the Compose proxy. |
| `THROTTLE_LIMIT` | `300` | Global requests per minute per principal (user, API key or anonymous IP). Raise it for a large swarm, then size the agent buckets below. |
| `AGENT_SESSION_RATE_LIMIT` | `0` (auto) | Per-agent-session weighted units per minute (a batch costs its command count). `0` = `max(600, THROTTLE_LIMIT)`; pinned values are at least `100`. |
| `AGENT_TOKEN_RATE_LIMIT` | `0` (auto) | Per-API-key agent weighted units per minute. `0` = `max(600, ceil(THROTTLE_LIMIT / 4))`; an explicit token `rateLimitPerMinute` is capped at this share (`min(explicit, derived)`). Pinned values are at least `100`. |
| `BOARD_RATE_LIMIT` | `0` (auto) | Per-board weighted-units safety ceiling shared by every agent on the board. `0` = `max(12000, 2 × THROTTLE_LIMIT)`. Raise it only with measured headroom; token and session buckets provide fairness. Pinned values are at least `100`. |
| `AGENT_COMMAND_QUEUE_MS` | `1500` | A command over the board ceiling waits this long for enough tokens/queue capacity, then answers `503 rate_limited` + `Retry-After`; `X-RateLimit-Queued-Ms` reports the total wait (`0` if the 64-queued-request/32-MiB serialized-JSON cap rejects immediately). Maximum `30000`; `0` answers immediately. |
| `BOARD_READ_CAP` / `BOARD_READ_QUEUE_MAX` | `16` / `256` | Full `GET /boards/:id` builds running at once **per API process** / waiting for a slot. Identical concurrent reads coalesce first, so only distinct board/role/projection/content-coding groups compete. With N replicas the cluster cap is N × this value. The cap may exceed `DB_CONNECTION_LIMIT` (default 10): extra builds wait on the Prisma pool up to `BOARD_READ_WAIT_MS`, then answer `503 board_read_busy`. Set the cap at or below the pool to avoid pool waits. |
| `BOARD_READ_WAIT_MS` / `BOARD_READ_TIMEOUT_MS` | `10000` / `20000` | Maximum semaphore/pool wait / **one shared response deadline** (stamp + wait + build + encode) before `503 board_read_busy`/`board_read_timeout`. The timeout must exceed the wait and be at least `300` ms. Each stage gets only the remaining budget, so a conditional miss cannot take WAIT+TIMEOUT. `WAIT_MS=0` disables semaphore queueing and pool wait, while the conditional stamp and transaction still use the shared deadline. The read transaction gets `timeout` = remaining minus an encode margin and `maxWait=min(WAIT_MS,budget)` when `WAIT_MS>0` (`WAIT_MS=0` => 0), with a transaction slice reserved so `maxWait+timeout` stays within the deadline; P2010/57014, P2024/P2028 become 503, not 500. A query already sent is not cancelled but expires by that budget. |
| `BOARD_READ_RETRY_AFTER_SECONDS` | `2` | `Retry-After` advertised when a full board read is refused. |
| `BOARD_READ_COMPRESS_MIN_BYTES` | `1024` | Bodies below this size stay uncompressed on `GET /boards/:id`; larger ones negotiate gzip/Brotli and always send `Vary: Accept-Encoding`. |
| `PORT` | `3000` | Host port to publish (container always listens on 3000). |
| `JANOSIK_TAG` | `latest` | Image tag to run (e.g. `v0.2.0`). |
| `SMTP_HOST` … `SMTP_PASS` | unset | Outgoing email. Password registration requires email delivery; production logs omit message contents. |
| `PURGE_AFTER_DAYS` | `30` | Retention for the hourly soft-delete sweep (fallback when the panel has no setting). |
| `MAX_BOARDS_PER_USER` | `0` | Server-mode board cap per account; `0` = unlimited (product default). Local/offline mode keeps its 10-board localStorage guard. |
| `AUDIT_RETENTION_DAYS` | `365` | Retention for the master audit trail (separate, longer window). |
| `DB_CONNECTION_LIMIT` | `10` | Prisma pool size per API process. Keep `replicas × this` well under `POSTGRES_MAX_CONNECTIONS`. |
| `REDIS_URL` | `redis://redis:6379` in Compose | Shared BullMQ, SSE fan-out, cache invalidation and throttler counters. Empty = single-process behaviour (the image logs a production warning). |
| `API_REPLICAS` | `3` | Replica count for the `docker-compose.scale.yml` overlay; `--scale app=N` overrides it for one run. |
| `API_CPUS` / `API_MEMORY_LIMIT` | `1.0` / `1536M` | Per-replica CPU and memory ceilings in the scale overlay. The V8 heap (`NODE_OPTIONS`) must stay below the memory limit. |
| `API_NOFILE` | `65536` | Per-replica `ulimits.nofile` (SSE connections and upload file descriptors). |
| `PROXY_CPUS` / `PROXY_MEMORY_LIMIT` | `0.5` / `512M` | Proxy CPU/memory ceilings. Raise to `1.0` / `1G` on 16 vCPU/32 GB. |
| `PROXY_NOFILE` | `131072` | Proxy `ulimits.nofile`; must cover client + upstream SSE connections. |
| `JANOSIK_PROXY_IMAGE` | `nginx:1.27-alpine` | Proxy image in the scale overlay; set `caddy:2-alpine` to use the bundled Caddyfile. |
| `MIGRATE_ON_BOOT` | `true` | Container entrypoint applies `prisma migrate deploy` before the API. The scale overlay sets it to `false` and runs the one-shot `migrate` service instead. |
| `MIGRATE_ONLY` | unset | Internal one-shot mode used by the scale overlay's `migrate` service: apply migrations and exit. |
| `SLOW_QUERY_MS` | `200` | Prisma queries at or above this duration are logged with the request id (`X-Request-Id`). `0` disables it. |
| `NODE_OPTIONS` | `--max-old-space-size=1024` | Node heap ceiling for the API process. Bounds memory so a live-stream surge triggers GC instead of the container OOM-killer. Raise it on a bigger host. |
| `SHARE_AGGREGATE_CACHE_MS` | `2000` | Live-share aggregate cache window. Each process stores up to 64 board aggregates by count and evicts the least recently used at capacity. Memory depends on board size. A changed board `seq` invalidates the entry. `0` disables storage. Up to 64 distinct rebuilds can run concurrently per process. A new rebuild at capacity returns `503`. |
| `ADMIN_METRICS_CACHE_MS` | `5000` | Master `/api/v1/admin/metrics` cache window (dropped on any moderation action). `0` disables. |
| `AUTH_CACHE_TTL_MS` | `15000` | PAT-by-sha256 resolution cache. Writes/SSE bypass it; revoke/pause invalidate it through the realtime bus. Keep it in the 10–30 s band; `0` disables. Bounded by `AUTH_CACHE_MAX_ENTRIES` (`5000`). |
| `MEMBERSHIP_CACHE_TTL_MS` | `30000` | `(user, board)` membership cache for reads and the SSE keep-alive. Writes/SSE bypass it; role/removal events invalidate it. `0` disables. Bounded by `MEMBERSHIP_CACHE_MAX_ENTRIES` (`10000`). |
| `FEATURE_FLAG_CACHE_MS` | `30000` | Raw feature-flag row cache; a flag update invalidates it on every node. `0` disables. Bounded by `FEATURE_FLAG_CACHE_MAX_ENTRIES` (`64`). |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | `shared_buffers` of the bundled Postgres container; raise on a larger host. |
| `POSTGRES_WORK_MEM` | `8MB` | `work_mem` of the bundled Postgres container. |
| `POSTGRES_MAX_CONNECTIONS` | `100` | `max_connections` of the bundled Postgres container. |
| `QUEUES_DASHBOARD` | `false` | Bull Board queue dashboard at `/api/v1/admin/queues` (OWNER only). |
| `SETTINGS_SECRET` | derived from `JWT_SECRET` | Encrypts SMTP credentials saved in the panel. |

OAuth (Google / Yandex) is configured in the panel, not in `.env`.

### Split deployment (app and site on different hosts)

The self-host image is a **single origin** — the site at `/`, the app at `/app/`
— so nothing needs configuring. If you serve the **app** and the **marketing
site/docs** from *different* hosts, point the two cross-links by hand:

| Direction | Variable | Set on the… | Value |
| --- | --- | --- | --- |
| Site → App ("Sign in" / "Create account" CTAs) | `PUBLIC_APP_URL` | **site** build | the app origin, e.g. `https://app.example.com/` |
| App → Site ("Help → Documentation") | `VITE_SITE_URL` | **UI** build | the site origin, with a trailing slash, e.g. `https://example.com/` |

If either value is wrong, the link opens a **404** — the site's not-found page for
the CTAs, or the app's not-found page for Help. This is the same pair the dev
setup needs, where the app (`:5173`) and the site (`:4321`) are always two
servers: `VITE_SITE_URL=http://localhost:4321/ npm run dev` and
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`. The image already sets
both for the single-origin layout (`UI_BASE=/app/`, `PUBLIC_APP_URL=/app/`).

When nginx serves the static builds from `deploy/nginx.conf`, build the site with
its public origin because nginx cannot rewrite canonical URLs, Open Graph URLs or
sitemaps at runtime. For a site with a path prefix, use for example
`SITE_BASE=/janosik/ SITE_URL=https://public-host PUBLIC_APP_URL=/app/ npm run build -w site`.
Mount the output at `/janosik/` and copy its `404.html` to nginx's document root
for the sample fallback. Keep `PUBLIC_APP_URL=/app/` if the app is on the same
origin at `/app/`, or use the full URL of your app. `SITE_BASE` prefixes
generated navigation, assets and SEO URLs. Root-relative links authored in the
docs body still resolve from the origin root. Serve those paths there or use a
root site build if every inline docs link must work without extra routing.

---

## 5. Email (optional)

Without SMTP no mail is sent and password registration is unavailable, except for the one-time `ALLOW_BOOTSTRAP_USER` first account. Configure email in the master panel before opening registration. Existing accounts created under the former automatic-verification policy should be reviewed by the operator; their email addresses were not proved by that policy. To link OAuth to an existing password account, sign in with the password, open Account → Security, and link a provider using the same email address.
Production logs omit message contents, including codes.

To send real mail, open `PUBLIC_ORIGIN/app/admin` → **Email service**, pick a
preset (Gmail / Yandex / Mail.ru / Brevo / SendGrid / custom SMTP), paste the
credentials and enable delivery. Gmail/Yandex/Mail.ru need an **app password**
(2-step verification on), not your login password.

---

## 6. Operations

For an installer-created instance, read the release notes before upgrading.
Back up the database, uploads and `.env`, then set `JANOSIK_TAG` in `.env` to
the desired release. If the release changes Compose, also download its matching
`docker-compose.yml` before pulling and restarting.

### Logs

```bash
docker compose logs -f app        # follow
docker compose logs --tail=200 app
```

### Upgrade

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically on container start, so no manual step is needed.
To pin a version, set `JANOSIK_TAG=v0.2.0` in `.env`.

Retention migrations add indexes for content and agent history. On an
existing installation with a lot of data and a direct Node.js (`npm`)
deployment, build them concurrently before migrating. The migrations reuse
those indexes:

```bash
npm run db:indexes --workspace backend
```

Compose users get the same statements inline on first start; schedule that
upgrade during a quiet period on a large installation.

### Scaling (streams and multiple nodes)

The default stack runs one `app` container, which serves a normal team
comfortably. Two knobs matter when a single process grows, and both have safe
defaults:

- **Live streams.** Every open board (and public share) holds one SSE
  connection (~0.1–0.17 MB each). Past a cap the instance refuses new streams
  with `503` + `Retry-After` instead of exhausting memory. While streams are
  open, it logs the active connection count once a minute. Tune with
  `SSE_MAX_CONNECTIONS` (per instance, default `5000`), `SSE_MAX_PER_USER`
  (default `32`) and `SSE_MAX_PER_BOARD` (default `0` = unlimited — a swarm
  legitimately holds many). `0` means unlimited for each.
- **Heap.** `NODE_OPTIONS=--max-old-space-size=…` (default `1024`) caps V8's old
  space so a surge triggers GC rather than the container OOM-killer, which would
  drop every open connection at once.

#### 2–4 API replicas behind nginx or Caddy

`docker-compose.scale.yml` is an overlay that runs 2–4 API replicas behind one
proxy. It is optional and does not change the single-container install. It and
the `deploy/scale/` configs ship with the source tree at the release tag; an
installer-created directory that only has `docker-compose.yml` needs those
files copied beside it (the compose paths are relative to the project root).
For a local image build, uncomment `build: .` on both the base `app` service and
the overlay's `migrate` service.

**Upgrading an existing install:** older `.env` files set `TRUST_PROXY=0`.
Because Compose passes an explicit value through, the overlay's default of 1
does not apply. Change it to `1` (or remove the line) before starting replicas,
otherwise every request appears to come from the proxy IP and rate limits are
wrong.

```bash
# Stop the single app first (named volumes survive), then start the proxy.
docker compose down
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --wait
```

The resulting topology is:

```text
browser / agents
      │  :3000 (or an external TLS proxy in front)
      ▼
  proxy (nginx by default, or Caddy)
      │  round-robin, no sticky sessions
      ├── app-1 ─┐
      ├── app-2  ├── PostgreSQL (one connection pool per replica)
      └── app-N ─┘── Redis (queues, SSE fan-out, shared limiter)
             shared uploads volume
```

- The proxy is the only published service; the replicas use the internal `app`
  alias and no host ports. `docker compose -f docker-compose.yml -f
  docker-compose.scale.yml ps` shows `…-app-1`, `…-app-2`, and so on.
- The UI and marketing site are baked into every image; attachments and avatars
  live on the shared `janosik-uploads` volume. Static and file downloads can be
  served by any replica.
- No sticky sessions are required. Access tokens are stateless, and an SSE
  client reconnects with `?since=<lastSeq>`, so it may land on a different
  replica and still replay the command log.
- A one-shot `migrate` service applies the schema once; replicas start with
  `MIGRATE_ON_BOOT=false`. A single-container install still migrates on boot.

Select Caddy instead of nginx by changing only the image (both configs are
mounted; each image reads its own):

```bash
JANOSIK_PROXY_IMAGE=caddy:2-alpine \
  docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --wait
```

Caddy is plain HTTP on `PORT` by default (put an external TLS proxy in front).
To let Caddy terminate TLS itself, replace `:8080` in `deploy/scale/Caddyfile`
with your domain, remove `auto_https off`, change the `proxy.ports` mapping to
`80:80` and `443:443`, and keep `PUBLIC_ORIGIN=https://…`.

Change the replica count for this run (the overlay default is `3`):

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d \
  --scale app=4 --wait
```

#### Sizing

These are starting points, not measured capacity claims. **No live horizontal
S2/S3 run was performed for this change**; the proxy/limit layer is
configuration- and unit-tested only. TASK-200.14 remains the capacity gate and
must confirm the numbers on a dedicated host before an SLO is promised.

| Host | Replicas | Per-replica CPU / memory | V8 heap | `DB_CONNECTION_LIMIT` | `SSE_MAX_CONNECTIONS` | Postgres |
| --- | --- | --- | --- | --- | --- | --- |
| 4 vCPU / 8 GB | 3 | `API_CPUS=1.0`, `API_MEMORY_LIMIT=1536M` | 768 MB | 10 (30 total) | 2000 (6000 total) | `shared_buffers=512MB`, `work_mem=8MB`, `max_connections=100` |
| 16 vCPU / 32 GB | 4 | `API_CPUS=3.0`, `API_MEMORY_LIMIT=5G` | 3.5 GB | 15 (60 total) | 5000 (20000 total) | `shared_buffers=4GB`, `work_mem=16MB`, `max_connections=200` |

The proxy holds both the client and upstream SSE connection, so its limits are
part of the host budget:

| Host | `PROXY_CPUS` | `PROXY_MEMORY_LIMIT` | `PROXY_NOFILE` | nginx main config |
| --- | --- | --- | --- | --- |
| 4 vCPU / 8 GB | 0.5 | 512 MB | 131072 | `worker_processes 4`, `worker_connections 65536`, `worker_rlimit_nofile 131072` |
| 16 vCPU / 32 GB | 1.0 | 1 GB | 131072 | same four workers; 65 536 connections per worker |

`deploy/scale/nginx-main.conf` is mounted as `/etc/nginx/nginx.conf`; the stock
nginx image's `worker_connections 1024` is not enough for the documented 6k/20k
streams. The same proxy limits apply when `JANOSIK_PROXY_IMAGE=caddy:2-alpine`.
`worker_rlimit_nofile` cannot exceed the container's hard nofile limit; the
container limit is `PROXY_NOFILE` (default 131 072). Keep
`PROXY_NOFILE >= worker_rlimit_nofile`; if the host or Docker enforces a smaller
limit, lower `PROXY_NOFILE` and the nginx value together.

The supported production range is **2–4 replicas** (the overlay defaults to 3).
Use one replica only for a rollback. Compose itself does not range-check the
value: a direct `docker compose ... up` with `API_REPLICAS=5` starts five
replicas, while `deploy/scale/rollout.sh` rejects it. Precedence is shell
environment → `.env` → overlay default (`3`).

Keep this inequality with headroom for the migration job and an admin CLI
session:

```text
replicas × DB_CONNECTION_LIMIT + ~10 < POSTGRES_MAX_CONNECTIONS
```

The bundled Postgres is sized for a small self-host. On the 16 vCPU host raise
`POSTGRES_SHARED_BUFFERS`, `POSTGRES_WORK_MEM` and `POSTGRES_MAX_CONNECTIONS`
in `.env`. Beyond roughly eight API replicas, add PgBouncer instead of raising
`max_connections` further (the TASK-200 gate marks this as a later step).

Set the per-replica limits in `.env`; the overlay reads them:

```dotenv
API_REPLICAS=3
API_CPUS=1.0
API_MEMORY_LIMIT=1536M
API_NOFILE=65536
NODE_OPTIONS=--max-old-space-size=768
DB_CONNECTION_LIMIT=10
SSE_MAX_CONNECTIONS=2000
PROXY_CPUS=0.5
PROXY_MEMORY_LIMIT=512M
PROXY_NOFILE=131072
JANOSIK_PROXY_IMAGE=nginx:1.27-alpine
```

`ulimits.nofile` is raised to 65 536 per replica and 131 072 for the proxy.
Memory and CPU ceilings are `deploy.resources.limits`; the V8 heap must stay
below the memory ceiling (leave roughly 300–500 MB for Node, Prisma and native
buffers).

#### Redis and cross-replica consistency

The base Compose stack already sets `REDIS_URL=redis://redis:6379`. With it:

- the global `@nestjs/throttler` counters are shared, so N replicas do not
  multiply `THROTTLE_LIMIT`;
- a master-panel rate-limit edit travels over the realtime control channel and
  applies on every replica without a restart;
- board SSE frames, presence-independent events and cache invalidations cross
  replicas;
- BullMQ workers spread across replicas.

Without Redis a single replica still works exactly as before: the limiter is
in-process, SSE fan-out is local, and cache invalidation is bounded by the
10–30 s TTL. A multi-replica install must set it. If Redis is configured but
unreachable, readiness answers `503`; rate limiting fails open to per-replica
counters and cross-replica SSE stops until Redis returns.

Known state and scope (Redis does not make every guard cluster-wide):

| State | Scope |
| --- | --- |
| Global per-principal `@nestjs/throttler` counters | **Cluster-wide** through Redis. |
| Live `THROTTLE_LIMIT` edits from the master panel | **Cluster-wide** through the realtime control channel; if Redis is down, local only until restart. |
| Login backoff | Redis-shared while Redis is healthy; bounded in-memory fallback per replica during an outage. |
| TTL caches (auth/membership/flags) | Per replica, invalidated through Redis; the 10–30 s TTL bounds a missed frame. |
| `BOARD_READ_CAP` / waiting room | Per replica. |
| Panel per-user rate limit | Per replica. |
| Explicit/default API-token limits | Per replica. |
| TASK-200.3 agent session/board budgets and the bounded board command queue | Per replica — safety ceilings, not a cluster quota. |
| Public-share per-token and OG limits | Per replica. |
| `SSE_MAX_CONNECTIONS`, `SSE_MAX_PER_USER`, `SSE_MAX_PER_BOARD` | Per replica. Anonymous public-share streams are capped per instance and per board, not per user. |
| Presence | Per replica. Two people may see different rosters depending on which replica their stream hit. |

With N replicas the effective ceiling of every per-replica row is N× its
configured value. Keep those values conservative and treat the shared
per-principal `THROTTLE_LIMIT` as the primary fairness guard.

#### Proxy behavior

The bundled configs live in `deploy/scale/nginx-main.conf`,
`deploy/scale/nginx.conf` and `deploy/scale/Caddyfile`:

- the full nginx main config raises `worker_connections` to 65 536 and
  `worker_rlimit_nofile` to 131 072 (the stock image's 1024 would cap the
  documented 6k/20k streams); nginx uses a shared upstream zone and
  `proxy_next_upstream_tries 0`, so a stale 3–4 replica rollout tries every
  healthy upstream;
- Caddy uses round-robin with `lb_try_duration`, `fail_duration` and
  `max_fails`, and proxies `/healthz` to the API readiness probe;
- gzip for identity text/CSS/JS/JSON (nginx also compresses identity API
  JSON; Caddy excludes `/api/` so the API negotiates its own encoding and SSE
  stays untouched); the API's own gzip/Brotli board reads pass through without
  a second compression;
- SSE locations (`/api/v1/boards/:id/events`, `/api/v1/share/:token/events`)
  disable buffering and use 3600 s read/send timeouts above the 60 s PAT /
  25 s human keep-alives, plus a 3600 s downstream nginx `send_timeout`
  (the default 60 s would cut a PAT stream during its 0–6 s keep-alive jitter);
  ordinary API requests use 90 s (covering the 60 s ready long-poll), and
  uploads/downloads use the long timeout without proxy buffering;
- `client_max_body_size 30m` for nginx attachments, imports and command
  batches; Caddy has no 1 MB body default and streams request bodies;
- upload routes (`cards/:id/attachments`, `users/*/avatar`, `boards/import`)
  and attachment/avatar downloads stream with the long timeout and a 3600 s
  `client_body_timeout`, so a slow 25 MB body does not get 408;
- static assets and uploads are forwarded to a replica with their existing
  `Cache-Control`/`ETag` headers preserved; nginx also caches content-hashed
  `/_astro/` and `/app/assets/` output for 7 days in a bounded 1 GB cache,
  while Caddy forwards it without an extra cache;
- the proxy's CPU/memory/nofile limits are part of the sizing table above.

If an external TLS terminator sits in front, the nginx config preserves its
`X-Forwarded-Proto` and sets `TRUST_PROXY=2` (the external hop plus the Compose
proxy). Prefer terminating TLS in Caddy when using that image, or add only the
outer proxy's exact CIDR to `servers { trusted_proxies static … }`; do not
trust every private address, because direct LAN clients could then spoof
`X-Forwarded-For`.

Validate the configs without starting the stack (the syntax probes use
throwaway nginx/Caddy containers):

```bash
npm run deploy:test
# optional, for the syntax containers:
docker pull nginx:1.27-alpine && docker pull caddy:2-alpine
```

For a live end-to-end check of cross-replica SSE (Linux Docker host; the cheap
unit smoke runs in the normal backend suite):

```bash
JANOSIK_TOKEN=jnk_… JANOSIK_BOARD_ID=<board-id> node deploy/scale/smoke-sse.mjs
```

It reads the board from one replica, opens the stream on another, commits an
`ADD_CARD` on the first, waits for the frame on the second, then deletes the
card.

#### Rolling update and rollback

A rollout re-creates the API service from the new image. Plain Compose replaces
a service as a unit, so there can be a short window with no API replica ready;
the proxy retries another upstream and SSE clients reconnect with `?since=`, but
this is not a zero-downtime rollout. Re-creating the proxy itself (needed when
its image or resource limits change) also has a brief public gap. On `SIGTERM`
the API completes its open streams and closes listeners (the image declares
`STOPSIGNAL SIGTERM`), so a replica stops without waiting for the whole
keep-alive period.

The replica count comes from `API_REPLICAS` in the environment or `.env`, or
from the overlay's default. The script never passes `--scale`, so a stale shell
value cannot shrink a running deployment. The same sequence is wrapped in
`deploy/scale/rollout.sh` (set `RUN_MIGRATIONS=false` when the release has no
schema change):

```bash
./deploy/scale/rollout.sh
```

Manual equivalent:

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.scale.yml"

# 1. Pull and (if the release changes the schema) run the one-shot job.
$COMPOSE pull
$COMPOSE run --rm migrate

# 2. Re-create the API service; --wait gates on health. The replica count is
#    API_REPLICAS / deploy.replicas, not a forced --scale value.
$COMPOSE up -d --no-deps app --wait

# 3. Re-create the proxy if its image or resource limits changed, then refresh
#    its replica list. nginx resolves `app` at startup, so the reload is
#    required after scaling or replacing replicas.
$COMPOSE up -d --no-deps proxy --wait
$COMPOSE exec -T proxy nginx -s reload
# Caddy variant:
# $COMPOSE exec -T proxy caddy reload --config /etc/caddy/Caddyfile

# 4. Confirm readiness through the proxy.
curl -fsS http://localhost:3000/api/v1/health/ready
```

For true zero-downtime rolling updates use an orchestrator (Swarm, Kubernetes)
or a blue/green proxy setup. The Compose path above is the supported
self-hosted middle ground: health-gated re-creation, proxy retries and SSE
resume, not a guarantee of no dropped request.

Rollback to **one replica behind the same proxy** (keeps the topology and any
TLS/domain wiring; the quickest safe step):

```bash
$COMPOSE up -d --scale app=1 --wait
$COMPOSE exec -T proxy nginx -s reload
```

Rollback to the **single-container install**:

```bash
$COMPOSE down                    # keeps the named volumes
docker compose up -d --wait      # the base stack publishes app on PORT again
```

If a release is bad, set `JANOSIK_TAG=<previous version>` in `.env`, then
`pull` and `up -d --wait` on either topology. Database migrations are forward
only; restore the matching backup if a schema rollback is required (see the
runbook).

#### Multi-host limits

The bundled stack is designed for replicas on **one Docker host**: they share
the `janosik-uploads` volume through the local Docker engine. Running replicas
on several hosts requires a shared POSIX filesystem for uploads (NFS, CephFS,
or an equivalent) and a shared Redis/Postgres reachable from every host.
Object storage for attachments is not implemented. Compose healthchecks are
not active load-balancer checks either: the proxy keeps forwarding to a
container that becomes unhealthy until it is removed or the proxy is reloaded.

### Backup, restore and rollback

Janosik does not create or verify server backups. A board export omits uploads.
For a consistent `pg_dump` and uploads pair, an isolated restore drill, and
rollback with the matching image and configuration, follow the
[operations runbook](../site/src/content/docs/docs/runbooks.md). The
[agent launch guide](../site/src/content/docs/docs/agent-launch.md) includes
the administrator and developer scenarios, checklist and upgrade notes
([Russian](../site/src/content/docs/ru/docs/agent-launch.md)).

### Stop / uninstall

```bash
docker compose down        # stop; data in volumes survives
docker compose down -v     # stop AND delete the database, Redis and uploads
```

---

## 7. Data locations

| Data | Where |
| --- | --- |
| Database | Docker volume `janosik-pgdata` |
| Redis | Docker volume `janosik-redisdata` |
| Attachments & avatars | Docker volume `janosik-uploads` |
| Configuration | `.env` next to `docker-compose.yml` |

---

## 8. Troubleshooting

**The app container restarts in a loop, logs mention "Refusing to start".**
You set `PUBLIC_ORIGIN` to an `http://` URL while `COOKIE_SECURE` is on (or
unset). Either serve over HTTPS, or — for a LAN trial only — set
`COOKIE_SECURE=false` and restart.

**Login works, then I'm bounced to the sign-in screen after ~15 minutes.**
The refresh cookie is being dropped. Almost always: the app is reached over
HTTP but `COOKIE_SECURE=true`, or a proxy isn't forwarding `X-Forwarded-Proto`.
Fix the TLS/proxy setup rather than lowering `COOKIE_SECURE`.

**Realtime edits don't appear in another browser.**
A proxy is buffering the SSE stream. Ensure it forwards to `127.0.0.1:3000`
(the API sends `X-Accel-Buffering: no`), and for nginx add `proxy_buffering off`.
In the scaled Compose stack use the bundled `deploy/scale/nginx.conf` or
`deploy/scale/Caddyfile`, which already disable buffering and set a 3600 s
timeout.

**502/504 after scaling or replacing replicas.**
nginx resolves the `app` service at startup and keeps the old replica IPs.
Reload it after a scale/rollout:
`docker compose -f docker-compose.yml -f docker-compose.scale.yml exec -T proxy nginx -s reload`
(or `caddy reload`). Until then `proxy_next_upstream` retries a request to
another replica, but the resolved list is stale.

**Rate limits or the audit log show the proxy's IP.**
Set `TRUST_PROXY=1` (and make sure the proxy sends `X-Forwarded-For`). The
scaled overlay defaults it to `1`; if an external TLS proxy sits in front of
the Compose proxy, use `TRUST_PROXY=2`.

**Limits multiply when I add replicas.**
Make sure `REDIS_URL` is set on every replica. Without it the global throttler
counts per process. The agent session/board budgets and the board command queue
remain per replica by design; see the known limits in the scaling section.

**Emails never arrive.**
Without `SMTP_*` the app cannot deliver email. Configure SMTP in `.env` or
configure **Email service** in the panel; production logs do not contain codes.

**`docker compose up` fails with "set JWT_SECRET".**
`.env` is missing or empty. Copy `.env.example` to `.env` and fill it in.

---

## 9. Security checklist

- [ ] Served over **HTTPS**, with `COOKIE_SECURE=true`.
- [ ] Strong, unique `JWT_SECRET` and `POSTGRES_PASSWORD`.
- [ ] `ALLOW_REGISTRATION=false` once your account exists.
- [ ] Reverse proxy in front, `TRUST_PROXY=1`.
- [ ] Only 80/443 exposed; the database and Redis stay internal.
- [ ] Regular `pg_dump` + uploads backups (and an occasional restore test).
- [ ] `docker compose pull && docker compose up -d` applied for security fixes.

Report vulnerabilities privately — see [SECURITY.md](../SECURITY.md).

## Publishing a self-host release (maintainers)

The installer selects the latest stable GitHub Release and downloads the
Compose file from its tag. CI publishes `ghcr.io/vitalytolstik/janosik:<tag>`
and `:latest` for a stable `vX.Y.Z` tag, after the verification and Docker
smoke jobs pass. A tag alone does not create a GitHub Release.

1. Choose the release version and update the root `package.json` and root
   entries in `package-lock.json` together (for example, `npm version 0.1.2
   --no-git-tag-version --workspaces=false`). The documentation header reads
   this version. Update release notes and examples as appropriate.
2. Merge and verify the changes, then push the matching `vX.Y.Z` tag from that
   commit. CI checks the tag against the root version and lockfile before it
   publishes images. Wait for both architectures.
3. Ensure the GHCR package is public and test an anonymous pull of the tagged
   image. Package visibility can require a one-time change in GitHub settings.
4. Publish the GitHub Release for that same tag with release and upgrade notes.
   Only publish it after the image is available: the installer treats the latest
   stable release as ready to install.
5. From a clean host with Docker, Compose, curl and OpenSSL, run the documented
   installer without registry credentials, create an account and check MCP.

For pre-release tags, CI publishes a tag-specific image but does not move
`:latest`. GitHub's latest release endpoint excludes pre-releases; the installer
uses stable releases only.

### Password recovery

Users with a verified email address and a local password can choose **Forgot password?** on the sign-in screen. When outgoing email is enabled, they receive a single-use recovery code valid for 15 minutes. A new request after the one-minute per-account cooldown replaces the previous code. The response does not disclose whether the account exists. Disabled accounts and OAuth-only accounts cannot use this flow; OAuth users should sign in with their provider.

A successful reset revokes refresh sessions and personal API keys and invalidates previously issued user access tokens. If email is disabled or delivery is unavailable, an instance owner can reset the user's password from the admin panel. Configure and test SMTP in the admin panel before relying on recovery.

Password recovery requests, successful and failed confirmations, and rate-limit violations appear in the admin audit log as `user.password_reset_*` events. Events are aggregated by IP and minute; codes and passwords are never recorded. Recovery emails are limited to one per account per minute, and requests are limited to three per IP per hour and confirmations to ten per IP per minute. Redis shares rate limits between instances when configured; otherwise limits are held in process.
