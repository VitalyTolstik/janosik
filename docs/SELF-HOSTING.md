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
| `app` | `ghcr.io/vitalytolstik/janosik` | The whole application: NestJS API under `/api/v1`, the built SPA, the master panel at `/admin`, background jobs. Serves on port `3000`. |
| `postgres` | `postgres:16-alpine` | The database (boards, users, command log, audit). |
| `redis` | `redis:7-alpine` | Job queues (mail, video transcoding, maintenance, exports). |

`postgres` and `redis` are **not** published to the host — only the app port
is exposed. On boot the `app` container applies database migrations, then
starts the API.

---

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

Good for kicking the tyres. Not for exposing to the internet.

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

Open `http://<host-ip>:3000`. Because this is plain HTTP, the app logs a loud
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
ALLOW_REGISTRATION=true
```

`PUBLIC_ORIGIN` must match the URL users actually open — it builds OAuth
callback URLs and drives the Secure-cookie check.

### 2.2 Start the stack

```bash
docker compose up -d
```

The app is now on `localhost:3000`, reachable only from the host.

### 2.3 Put TLS in front

**Caddy** — the simplest option; it provisions a Let's Encrypt certificate
automatically:

```caddyfile
# /etc/caddy/Caddyfile
kanban.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**nginx** — terminate TLS and proxy everything to the app. Realtime works
without extra tuning because the API sends `X-Accel-Buffering: no`, but
turning buffering off explicitly is harmless and makes the intent clear:

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
        proxy_read_timeout 3600s;     # keep long-lived streams open
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

1. **Create your account.** Open `PUBLIC_ORIGIN`, click **Create account**.
   The first account is a normal user — there is no auto-admin.
2. **Close registration.** Set `ALLOW_REGISTRATION=false` in `.env` and
   `docker compose up -d`. (Or toggle **Feature flags → Open registration** in
   the panel later.) The sign-in screen then hides the register form.
3. **Create a master (platform admin).** The panel at `/admin` belongs to a
   *master* account, which lives outside the user table and can only be created
   by the CLI — there is deliberately no HTTP endpoint for it:

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
   # hidden password prompt (typed twice); the first master becomes OWNER
   docker compose exec app node backend/scripts/admin-cli.cjs list
   ```

   Sign in at `PUBLIC_ORIGIN/admin`.

   Re-key an existing master (also revokes its sessions and clears lockouts):

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs passwd --email me@example.com
   ```

---

## 4. Environment reference

Every variable is documented in [`.env.example`](../.env.example). The ones
that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `JWT_SECRET` | — (**required**) | Access-token signing key. `openssl rand -hex 32`. Never change it casually — everyone is logged out. |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Public URL. Builds OAuth callbacks; must be `https://…` for `COOKIE_SECURE=true`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `janosik` / — / `janosik` | Database credentials (created on first `up`). |
| `COOKIE_SECURE` | `false` in the example | `Secure` flag on the refresh cookie. **Set `true` behind HTTPS.** A production install served over HTTP **refuses to boot** unless this is explicitly `false`. |
| `ALLOW_REGISTRATION` | `true` | Open sign-up. Turn off after creating your account. |
| `TRUST_PROXY` | `0` | Number of trusted proxy hops. Set `1` behind one reverse proxy. |
| `PORT` | `3000` | Host port to publish (container always listens on 3000). |
| `JANOSIK_TAG` | `latest` | Image tag to run (e.g. `v0.1.0`). |
| `SMTP_HOST` … `SMTP_PASS` | unset | Outgoing email. Unset = **log mode**: codes are written to the server log and registration auto-verifies. |
| `PURGE_AFTER_DAYS` | `30` | Retention for the hourly soft-delete sweep (fallback when the panel has no setting). |
| `QUEUES_DASHBOARD` | `false` | Bull Board queue dashboard at `/admin/queues` (OWNER only). |
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

Get either wrong and a link lands on a **404** — the site's not-found page for
the CTAs, or the app's not-found page for Help. This is the same pair the dev
setup needs, where the app (`:5173`) and the site (`:4321`) are always two
servers: `VITE_SITE_URL=http://localhost:4321/ npm run dev` and
`PUBLIC_APP_URL=http://localhost:5173 npm run dev:site`. The image already sets
both for the single-origin layout (`UI_BASE=/app/`, `PUBLIC_APP_URL=/app/`).

---

## 5. Email (optional)

Out of the box the app runs in **log mode** — no mail is sent, and verification
codes are printed to `docker compose logs app`. That is fine for a single-user
install.

To send real mail, open `PUBLIC_ORIGIN/admin` → **Email service**, pick a
preset (Gmail / Yandex / Mail.ru / Brevo / SendGrid / custom SMTP), paste the
credentials and enable delivery. Gmail/Yandex/Mail.ru need an **app password**
(2-step verification on), not your login password.

---

## 6. Operations

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
To pin a version, set `JANOSIK_TAG=v0.1.0` in `.env`.

### Backup

```bash
# database
docker compose exec postgres pg_dump -U janosik janosik > backup-$(date +%F).sql

# uploaded files (attachments, avatars) from the volume
docker run --rm \
  -v janosik_janosik-uploads:/data \
  -v "$PWD:/out" \
  alpine tar czf /out/uploads-$(date +%F).tar.gz -C /data .
```

(The volume name is prefixed with the Compose project — usually the folder
name. Check with `docker volume ls`.)

### Restore

```bash
docker compose exec -T postgres psql -U janosik janosik < backup-2026-10-26.sql
docker run --rm -v janosik_janosik-uploads:/data -v "$PWD:/out" alpine \
  sh -c "rm -rf /data/* && tar xzf /out/uploads-2026-10-26.tar.gz -C /data"
```

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

**Rate limits or the audit log show the proxy's IP.**
Set `TRUST_PROXY=1` (and make sure the proxy sends `X-Forwarded-For`).

**Emails never arrive.**
Without `SMTP_*` the app is in log mode by design — check
`docker compose logs app`, or configure **Email service** in the panel.

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
- [ ] `docker compose pull && up -d` applied for security fixes.

Report vulnerabilities privately — see [SECURITY.md](../SECURITY.md).
