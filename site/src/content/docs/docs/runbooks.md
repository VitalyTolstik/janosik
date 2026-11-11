---
title: Operations runbooks
description: Numbered procedures for backup, restore, upgrade, monitoring and troubleshooting.
---

Each runbook is a numbered list. Every step is one action and copy-pasteable.
Steps that change state name their rollback. Steps marked **Risky** can destroy
data; take the backup first.

## Backup

Janosik does not create, schedule or verify server backups. Board and account
exports do not include uploaded blobs and are not a disaster-recovery backup.
This procedure uses the bundled Compose PostgreSQL and `/data/uploads`; for an
external database or storage, adapt it to that provider. Run from the Compose
directory on a Linux host. Use a maintenance window: stop **all** app replicas,
workers and external writers so the database and files describe the same point.
Record the image tag, Compose file and configuration alongside the pair.
Drain or record pending jobs before stopping writers. This procedure does not
back up Redis queues; restoring a database against a different queue state can
lose or replay pending work. Plan queue recovery for the installation; do not
blindly connect restored data to a live production Redis.

1. Stop writers, then dump the database and archive uploads. Replace the
   filenames with a unique backup identifier and keep the pair together.
   The database credentials come from the running PostgreSQL container.

   ```bash
   docker compose stop app
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup.sql
   docker run --rm --volumes-from "$(docker compose ps -aq app):ro" -v "$PWD:/out" \
     alpine tar czf /out/uploads.tar.gz -C /data/uploads .
   ```

   Check the exit status of **each** command; discard a partial dump/archive
   on failure and do not treat it as a backup. If any step fails, resolve it
   before resuming writers. This example assumes one app container; for multiple
   replicas, identify and archive the shared uploads storage explicitly.

2. Resume the application with `docker compose start app`, check
   `/api/v1/health/ready`, and store both files off-host with a protected copy
   of `.env` and the matching Compose file. Encrypt and restrict access: the
   dump, uploads and configuration contain sensitive data. Record the time,
   version, filenames and command results. A successful archive is not a
   verified restore.

## Restore

**Risky:** this replaces the target database and all target uploads. The
following uses PostgreSQL 16 in the bundled stack and the database superuser
created by its image. Never point it at production for a drill. For production,
first take a fresh **pair** using Backup above; keep it and the current image,
Compose file and configuration for rollback. Recreating the database removes
objects absent from the dump as well as existing data. All writers and other
database connections must be stopped.

1. Choose the matching `backup.sql` and `uploads.tar.gz` from the same
   backup. Check the archive is readable with `tar tzf uploads.tar.gz > /dev/null`.
   Use the application image and Compose version recorded with that backup.
   Review Redis queue state before starting workers; reconcile pending work
   according to your recovery plan.
2. Stop every app replica and worker. For the bundled single-app stack:

   ```bash
   docker compose stop app
   ```

3. **Risky:** recreate the configured database, then load the dump. A failure
   leaves the database incomplete; keep the app stopped and investigate or
   restore the pre-restore pair.

   ```bash
   docker compose exec -T postgres sh -c 'dropdb --if-exists --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup.sql
   ```

4. **Risky:** replace uploads only after confirming the target volume and
   archive. This deletes the current contents.

   ```bash
   docker run --rm --volumes-from "$(docker compose ps -aq app)" -v "$PWD:/out" alpine \
     sh -c 'find /data/uploads -mindepth 1 -delete && tar xzf /out/uploads.tar.gz -C /data/uploads'
   ```

   If extraction fails, keep the app stopped and restore the pre-restore pair.
5. Start the matching app version: `docker compose up -d app`. Check readiness,
   logs, sign-in, representative boards and attachment downloads. To undo a
   failed restore, repeat this procedure with the fresh pre-restore database
   **and** uploads pair and its matching image/configuration.

## Restore drill

Use a separate host or isolated Compose project with its own database, Redis,
uploads volume, ports and configuration. Block access to production services
and outbound email/OAuth or other integrations; a copied database can contain
live credentials and scheduled work. Never reuse production volumes or point
the drill at production PostgreSQL. Provision the recorded image and Compose
version, then run Restore against the isolated stack using a copied backup pair.

Record the backup timestamp, image version, operator, duration and result.
Verify readiness, sign-in, representative board/card data and several
attachments/avatars against known samples; confirm no production writes or
notifications occurred. Investigate failures, correct the backup process and
repeat the drill. Protect and remove the isolated copy under your data policy.

## Upgrade rollback

Before upgrading, capture the consistent backup pair, previous image tag,
Compose file and configuration. If the upgrade fails, stop all writers. Prisma
migrations run forward on startup; simply switching back to the old image may
not be compatible with the migrated database. Restore the **pre-upgrade
database and uploads together** using Restore and the previous image/Compose
configuration, then verify readiness, board data and files before reopening
traffic. Writes made after the backup are lost: communicate the recovery point
and keep the failed deployment's data separately if needed for investigation.

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

   Rollback: follow [Upgrade rollback](#upgrade-rollback) with the pre-upgrade database and uploads pair and previous image/Compose.

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
