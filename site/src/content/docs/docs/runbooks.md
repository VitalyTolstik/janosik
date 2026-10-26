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
   docker compose exec postgres pg_dump -U janosik janosik > backup-$(date +%F).sql
   ```

   Rollback: none. This step only reads.

2. Archive the uploads volume (attachments and avatars).

   ```bash
   docker run --rm \
     -v janosik_janosik-uploads:/data \
     -v "$PWD:/out" \
     alpine tar czf /out/uploads-$(date +%F).tar.gz -C /data .
   ```

   The volume name is prefixed with the Compose project, usually the folder
   name. Check the real name with `docker volume ls`. Rollback: none. This
   step only reads.

3. Copy both files off the host.

## Restore

**Risky.** A restore overwrites live data. Take a fresh backup in step 1 so you
can undo the whole runbook.

1. Take a fresh backup of the current database before touching anything.

   ```bash
   docker compose exec postgres pg_dump -U janosik janosik > pre-restore-$(date +%F).sql
   ```

   Rollback: none. This step only reads.

2. Stop the app so it stops writing during the restore.

   ```bash
   docker compose stop app
   ```

   Rollback: `docker compose start app`.

3. **Risky.** Restore the database. This overwrites the current data.

   ```bash
   docker compose exec -T postgres psql -U janosik janosik < backup-2026-10-26.sql
   ```

   Rollback: load the dump from step 1.

4. **Risky.** Restore the uploads volume. The command deletes the current
   contents first.

   ```bash
   docker run --rm -v janosik_janosik-uploads:/data -v "$PWD:/out" alpine \
     sh -c "rm -rf /data/* && tar xzf /out/uploads-2026-10-26.tar.gz -C /data"
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

1. Pin the target version (optional). Set `JANOSIK_TAG=v0.1.0` in `.env`.

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

   Rollback: set `JANOSIK_TAG` back to the previous tag and run
   `docker compose up -d`. Migrations are forward-only, so if a migration
   cannot be reversed, restore the database backup you took before upgrading
   (see [Restore](#restore)).

## Monitoring

### Health endpoint

`GET /api/v1/health` is the readiness probe. It is exempt from the global rate
limit, so an orchestrator can poll it freely.

```bash
curl -fsS http://localhost:3000/api/v1/health
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
`{"status":"error","db":"up","redis":"down"}`. The [API reference](api/)
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

## Security checklist

- [ ] Served over HTTPS, with `COOKIE_SECURE=true`.
- [ ] Strong, unique `JWT_SECRET` and `POSTGRES_PASSWORD`.
- [ ] `ALLOW_REGISTRATION=false` once your account exists.
- [ ] Reverse proxy in front, `TRUST_PROXY=1`.
- [ ] Only `80` and `443` exposed; the database and Redis stay internal.
- [ ] Regular `pg_dump` and uploads backups, plus an occasional restore test.
- [ ] `docker compose pull && docker compose up -d` applied for security fixes.

See [Security](security/) for the controls the server implements. Report
vulnerabilities privately, never in a public issue.
