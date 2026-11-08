---
title: Operations runbooks
description: Numbered procedures for backup, restore, upgrade, monitoring and troubleshooting.
---

Each runbook is a numbered list. Every step is one action and copy-pasteable.
Steps that change state name their rollback. Steps marked **Risky** can destroy
data; take the backup first.

## Backup

Back up both the database and the uploads volume. Neither step changes state.

1. Dump the database to a dated file in the current directory.

   ```bash
   docker compose exec -T postgres pg_dump --clean --if-exists -U janosik janosik > backup-$(date +%F).sql
   ```

   Rollback: none. This step only reads.

2. Archive the uploads volume (attachments and avatars).

   ```bash
   docker run --rm \
     --volumes-from "$(docker compose ps -aq app):ro" \
     -v "$PWD:/out" \
     alpine tar czf /out/uploads-$(date +%F).tar.gz -C /data/uploads .
   ```

   This uses the app container's uploads volume even when the installer chose
   a unique project name. Rollback: none. This step only reads.

3. Copy both files and `.env` off the host to a secure location. The `.env`
   file contains the installation's secrets.

## Restore

**Risky.** A restore overwrites live data. Take a fresh backup in step 1 so you
can undo the whole runbook.

1. Take a fresh backup of the current database before touching anything.

   ```bash
   docker compose exec -T postgres pg_dump --clean --if-exists -U janosik janosik > pre-restore-$(date +%F).sql
   ```

   Rollback: none. This step only reads.

2. Stop the app so it stops writing during the restore.

   ```bash
   docker compose stop app
   ```

   Rollback: `docker compose start app`.

3. **Risky.** Restore the database. This overwrites the current data.

   ```bash
   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U janosik janosik < backup-2026-10-26.sql
   ```

   Rollback: load the dump from step 1.

4. **Risky.** Restore the uploads volume. The command deletes the current
   contents first.

   ```bash
   docker run --rm --volumes-from "$(docker compose ps -aq app)" -v "$PWD:/out" alpine \
     sh -c "find /data/uploads -mindepth 1 -delete && tar xzf /out/uploads-2026-10-26.tar.gz -C /data/uploads"
   ```

   Rollback: restore the uploads archive you took before this runbook.

5. Start the app again.

   ```bash
   docker compose start app
   ```

   Rollback: none needed. The stack is back to its normal state.

## Upgrade

Migrations run automatically when the app container starts, so an upgrade has
no manual migration step.

1. Read the release notes and back up the database, uploads and `.env`. Set
   `JANOSIK_TAG` in `.env` to the desired release (for example `v0.2.0`).
   The installer pins the initial version, so pulling alone will not upgrade
   it. Review and download the matching Compose file from that release; replace
   `v0.2.0` in the URL with your chosen tag:

   ```bash
   curl -fsSL -o docker-compose.yml.new https://raw.githubusercontent.com/VitalyTolstik/janosik/v0.2.0/docker-compose.yml
   # Review docker-compose.yml.new, then replace docker-compose.yml with it.
   ```

   Rollback: change the value or remove the line.

2. Pull the new image.

   ```bash
   docker compose pull
   ```

   Rollback: none. This step only downloads.

3. Recreate the stack.

   ```bash
   docker compose up -d
   ```

   The entrypoint runs `npx prisma migrate deploy` before the API starts.
   Two things can make the first start after an upgrade slower. A migration
   that adds an index builds it before the API comes up; the command-log time
   indexes, for example, take longer on a large log. And when the uploads
   volume still belongs to root (it was created by an older image that ran as
   root), the entrypoint hands it to the `node` user once with `chown -R`,
   which takes a while on a large volume.

   The retention indexes (soft-delete, token, share, invitation, reminder)
   are built the same way. On a direct Node.js (`npm`) deployment with a large
   database, build them without a write lock before upgrading; the migration
   then finds them and is instant:

   ```bash
   npm run db:indexes --workspace backend
   ```

   Rollback: set `JANOSIK_TAG` back to the previous tag and run
   `docker compose up -d`. Migrations are forward-only, so if a migration
   cannot be reversed, restore the database backup you took before upgrading
   (see [Restore](#restore)).

## Monitoring

### Health endpoints

`GET /api/v1/health` is the **liveness** probe: it always answers `200` and
touches neither the database nor Redis, so an orchestrator can restart a stuck
process on it.

`GET /api/v1/health/ready` is the **readiness** probe: it checks the database
(and Redis when configured) and answers `503` when a dependency is down. The
result is cached for a couple of seconds, so probe traffic cannot amplify onto
the connection pool. Both are exempt from the global rate limit.

```bash
curl -fsS http://localhost:3000/api/v1/health/ready
```

The response has three fields:

| Field | Values |
| --- | --- |
| `status` | `ok` or `error` |
| `db` | `up` or `down` |
| `redis` | `up`, `down` or `disabled` |

A healthy instance answers `200` with `{"status":"ok","db":"up","redis":"up"}`.
`redis` is `disabled` when no `REDIS_URL` is configured. A failed database ping
answers `503` with `{"status":"error","db":"down","redis":"..."}`. A configured
but unreachable Redis also answers `503` with
`{"status":"error","db":"up","redis":"down"}`. The [API reference](/docs/api/)
documents the same shape.

### Admin observability page

The master panel has an observability page at `/admin/observability`. It loads
a single read-only snapshot:

| Field | Value |
| --- | --- |
| `version` | backend package version |
| `nodeEnv` | `NODE_ENV` |
| `uptimeSec` | process uptime in seconds |
| `deploy.startedAt` | process start time |
| `deploy.commit` | build commit, or `null` |
| `database.sizePretty` | database size |
| `database.tables` | the twelve largest tables with row counts and sizes |
| `jobs.transcode` | pending, done and failed transcodes |
| `jobs.demo` | demo board running state and board id |
| `jobs.realtime` | active board channels and connected clients |
| `jobs.queues` | per-queue pending, processed and failed counters, with the backend (`redis` or `memory`) |
| `health` | database, realtime and maintenance checks |

Every field degrades gracefully when a subsystem is unavailable.

### Logs

```bash
docker compose logs -f app        # follow
docker compose logs --tail=200 app
```

## Scaling

One small host serves a normal team. Two knobs matter as you grow, both with
safe defaults:

- **Live streams.** Each open board (and public share) holds one SSE connection
  (~0.1–0.17 MB). Past a cap the instance refuses new streams with `503` +
  `Retry-After` instead of exhausting memory. While streams are open, the API
  logs the active connection count once a minute. Tune with `SSE_MAX_CONNECTIONS` (per instance,
  default `5000`), `SSE_MAX_PER_USER` (default `32`) and `SSE_MAX_PER_BOARD`
  (default `0` = unlimited). `0` means unlimited for each.
- **Heap.** `NODE_OPTIONS=--max-old-space-size=…` (default `1024`) caps V8's old
  space so a surge triggers GC instead of the container OOM-killer.

**Multiple nodes.** With Redis configured the board fan-out is already
cross-node and queue workers spread across replicas, so you can run several API
replicas behind a load balancer: drop the host `ports:` mapping and let the
balancer reach the replicas on the container network, and set `TRUST_PROXY=1`.
Keep `DB_CONNECTION_LIMIT` × replicas under `POSTGRES_MAX_CONNECTIONS`. Presence
(the list of people on a board) is stored per node for now, so it can differ
between nodes. A single node is usually sufficient for a small team.

## Troubleshooting

**The app container restarts in a loop, and the logs mention `Refusing to
start`.** `PUBLIC_ORIGIN` is an `http://` URL while `COOKIE_SECURE` is on or
unset. Either serve over HTTPS, or, for a LAN trial only, set
`COOKIE_SECURE=false` and restart. The server logs the full message:
`Refusing to start: NODE_ENV=production but PUBLIC_ORIGIN is not HTTPS (...)`.

**Login works, then you are bounced to the sign-in screen after about 15
minutes.** The refresh cookie is being dropped. Almost always the app is
reached over HTTP while `COOKIE_SECURE=true`, or a proxy is not forwarding
`X-Forwarded-Proto`. Fix the TLS or proxy setup rather than lowering
`COOKIE_SECURE`.

**Realtime edits do not appear in another browser.** A proxy is buffering the
SSE stream. Ensure it forwards to `127.0.0.1:3000` (the API sends
`X-Accel-Buffering: no`), and for nginx add `proxy_buffering off`.

**Rate limits or the audit log show the proxy's IP.** Set `TRUST_PROXY=1`, and
make sure the proxy sends `X-Forwarded-For`.

**Emails never arrive.** Without `SMTP_HOST` the app is in log mode by design.
Check `docker compose logs app`, or configure **Email service** in the master
panel.

**`docker compose up` fails with `set JWT_SECRET`.** `.env` is missing or
empty. Copy `.env.example` to `.env` and fill it in.

**The app container exits at once, and the logs say `POSTGRES_PASSWORD is
still the example value 'change-me'`.** Set a real password in `.env` (for
example `openssl rand -hex 24`). On an existing install the database already
has the old password, so change it in PostgreSQL first, then update `.env`
and run `docker compose up -d`:

```bash
docker compose exec postgres psql -U janosik -c "ALTER USER janosik WITH PASSWORD '<new password>'"
```

Replace `janosik` with your `POSTGRES_USER` if it differs.

**Attachments or board imports fail with `413` behind nginx.** nginx refuses
bodies over 1 MB by default. Add `client_max_body_size 30m;` to the server
block (see [Self-hosting](../self-hosting/#put-tls-in-front)) and reload nginx.

**After rebuilding the frontend from source, the browser console reports a
blocked inline script.** The API allows inline scripts by hashes it computes
at startup. Restart the API after every frontend rebuild. The container image
does this on every deploy.

**Sign-in answers "Too many failed sign-in attempts".** The address is in
login backoff after five or more wrong passwords. Wait for the time shown (at
most 15 minutes); the lock clears on the next successful sign-in.

## Security checklist

- [ ] Served over HTTPS, with `COOKIE_SECURE=true`.
- [ ] Strong, unique `JWT_SECRET` and `POSTGRES_PASSWORD` (never the example
      `change-me`, which the container refuses).
- [ ] `ALLOW_REGISTRATION=false` once your account exists.
- [ ] Reverse proxy in front, `TRUST_PROXY=1`.
- [ ] Only `80` and `443` exposed; the database and Redis stay internal.
- [ ] Regular `pg_dump` and uploads backups, plus an occasional restore test.
- [ ] `docker compose pull && docker compose up -d` applied for security fixes.

See [Security](/docs/security/) for the controls the server implements. Report
vulnerabilities privately, never in a public issue.
