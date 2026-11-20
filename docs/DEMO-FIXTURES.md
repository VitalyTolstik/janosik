# TASK-176 demo fixture

Run these commands from the repository root on Linux or WSL with readable
`/proc`, `flock`, the repository's Node version, and disposable PostgreSQL 16.
Use a separate database or board for manual experiments. The reset works on
the entire target database or the entire fixture/account scope described below.

## Set up the target

Create the disposable database `janosik_task176_demo`. The reset applies the
current migrations. The PostgreSQL role needs permission to own or recreate the
`public` schema, apply migrations, and terminate other connections to the demo
database. Stop any regular backends or other jobs using that database before
resetting.

Set `DEMO_DATABASE_URL` and `DEMO_API_URL` explicitly. The database name must
be `janosik_task176_demo`. For a disposable database whose name ends in
`_demo`, also set `DEMO_ALLOW_OTHER_DB=1`. The API URL must be
`http://127.0.0.1:<port>` with a free port above 1023. Reset refuses conflicting
shell `DATABASE_URL` or `API_URL` values and refuses `NODE_ENV=production`.

Set `JWT_SECRET` to at least 32 characters in the shell. If you plan to run a
regular demo backend after reset, make its `PUBLIC_ORIGIN` and secrets
appropriate for the demo. The reset backend uses its loopback API URL as
`PUBLIC_ORIGIN` unless you supply an override.

```bash
npm ci
npm run build -w backend

read -rsp 'Disposable demo database URL: ' DEMO_DATABASE_URL
printf '\n'
export DEMO_DATABASE_URL
export DEMO_API_URL=http://127.0.0.1:5311
read -rsp 'Demo JWT secret: ' JWT_SECRET
printf '\n'
export JWT_SECRET
export DEMO_RESET_ALLOW=1

npm run demo:task176:reset -- --dry-run
npm run demo:task176:reset
npm run demo:task176:verify
```

The primary reset runs `prisma migrate reset --force --skip-generate --skip-seed`.
It recreates the demo schema and clears all data there, including global
settings and master accounts. With a complete schema, the wrapper first starts
a private loopback backend and proves its database identity with a temporary
user, board and accepted ADMIN membership created through Prisma. The probe
signs a short-lived user JWT and makes a single board GET. A failed probe
leaves the fixture untouched. After marker cleanup and backend shutdown, the
wrapper terminates remaining demo connections and prints their PostgreSQL PIDs.
After migrating, it starts the backend for the seed, proves identity against a
fresh connection, and stops and reaps it before verification.

Each backend boot consumes a private 0600 nonce-bound env file supplied via CLI
flags. Reset boot bypasses `backend/.env`, `.env.<NODE_ENV>` and `.env.local`,
sets `COOKIE_SECURE=false`, and uses the backend's test environment to keep
scheduled jobs off. Regular backend boot continues to load its normal env
files.

After a crash, rerun `npm run demo:task176:reset` with the same demo settings.
While holding the per-database file lock and PostgreSQL lease, reset checks the
connected database name, required `public` tables and columns, and completed
migrations. For a missing, empty, or partially migrated schema, it first
recreates the schema on the guarded demo database. The API identity probe and
one-time seed authorization run against the repaired schema before any fixture
seeding. This recovery uses the primary reset's full schema scope.

The wrapper checks process identity before signaling a stale backend group and
sweeps stale reset files. The reset releases the lock on exit and leaves the
lock file and its inode in place for reuse in
`$XDG_RUNTIME_DIR/janosik/<database>` when set, or
`~/.local/state/janosik/<database>` otherwise. The `janosik` state directory and
its per-database directories use mode 0700. The shared state home may be 0755
and must be owned by the current user and writable only by that user. Keep the
runtime directory consistent across runs and leave the lock file in place. If
process ownership is unproven, the reset fails closed.

After schema inspection confirms a complete schema, the wrapper sweeps stale
`task176-marker-*` and `t176-marker-*` IDs before booting the probe backend and
before any destructive reset work. It removes marker memberships and refresh
tokens before deleting marker boards and users. If a foreign key blocks the
sweep, the reset identifies the child table and stops. Remove the rows
referencing those stale markers from the named table in the disposable
database, then rerun the reset. Probe cleanup tolerates missing relations or
columns and the wrapper sweeps again after migration.

## Keep global settings

```bash
npm run demo:task176:reset -- --fallback
```

The fallback requires a complete schema and resets fixture data and
admin/security accounts in one ordered transaction. It retains feature flags,
mail settings and templates, OAuth provider settings, operational and throttle
settings, and announcements with their translations. Announcement dismissals
cascade when their users are deleted. Keep the original `SETTINGS_SECRET` in
the shell so retained SMTP and
OAuth credentials remain decryptable. If the original `SETTINGS_SECRET` was
empty, keep the original `JWT_SECRET`. If the original key is unavailable,
re-enter the saved credentials in the demo master panel.

The fallback deletes attachment rows and leaves any uploaded blobs in the
regular backend's configured upload directory. File removal is separate and
must be limited to storage explicitly set aside for disposable demo uploads.

An identity probe rejected by saved maintenance mode or throttling aborts
before reset. Use the demo master panel to make the demo backend available for
the probe, then rerun the command.

## Recreate the master account

Both reset modes clear master accounts, admin sessions and admin audit state.
Recreate the first master when admin login is needed. The first master is an
OWNER. Use the hidden prompt, or set `ADMIN_PASSWORD` in the environment for
automation. The wrapper uses `DEMO_DATABASE_URL` from the environment.
`DATABASE_URL`, `API_URL`, and `DEMO_API_URL` are unnecessary for this command.

```bash
npm run demo:task176:admin -- --email owner@example.com
```

Reset and verify print the target host/database and verification results. Reset
also prints stable seed identifiers, the private API port and process PIDs.
Passwords, complete DSNs, PATs and JWTs stay out of logs and command-line
arguments. To export the disposable seed login and PATs, set
`SEED_SECRETS_FILE` to a new file path before reset. The script creates it
exclusively with mode 0600. The standalone pixel parity seed supports the same
export and accepts only `*_pixel` databases, with `DEMO_*` left unset.

## What verification checks

The [manifest](../scripts/fixtures/task176-demo.mjs) pins two app users and
their accepted roles, two boards, eight ordered columns, 13 cards (12 live),
one label attachment, one checklist with three completed items, and two
ordered card links. The Agent Ops admin is the Website member, and the
Website admin is the Agent Ops member. The manifest includes titles,
descriptions, positions, deletion state and absent cover, priority, assignee,
due date, task spec, claim and archive fields for every card.

- `Card claim visibility` stays in Agent Ops Backlog at position 0. The
  manually applied assignee, yellow cover, blocker priority and move to Done
  are drift, along with the `123` title suffix and `фывфыв` description suffix.
- Keep the pink `TASK-176 demo` label, the `TASK-176 acceptance` checklist and
  items, and links `px-link-task176-demo` (relates to MCP write contract) and
  `px-link-task176-blocks` (blocks Approval inbox polish). Remove the random
  UUID link, checklist `123` and item `1`. The canonical fixture creates the
  final label attachment directly, without recording label toggle commands.
- The 60 `t176-comment-*` rows, including the nine soft-deleted rows, belong to
  manual TASK-176.9 testing. The canonical TASK-176 comment set is empty.
- The seed's `run-124` represents a reverted history state in the UI. Its card
  deletion remains applied because the seed stores that status without a
  restore command. The verifier expects the soft-deleted onboarding card.
- Extra registrations, including `1@t.com` and `2@t.com`, fail verification.
  Admin, security, session, notification, reminder and idempotency rows are
  outside the fixture. Run timestamps and other runtime state can change.

The verifier needs only `DEMO_DATABASE_URL` for its target. `DATABASE_URL`,
`API_URL`, and `DEMO_API_URL` are unnecessary. It uses Prisma in a PostgreSQL
read-only snapshot transaction, with no API login or PAT use, so refresh
tokens and PAT usage timestamps stay untouched. A mismatch reports the model,
expected record and differing field or count. Record that diagnostic and
rerun the reset to repair the fixture.

Successful verification prints both SHA-256 hashes.

- **Live rows SHA-256** hashes the UTF-8 JSON of the selected fields read from
  the verified PostgreSQL snapshot. Model and field names are sorted
  lexicographically, rows follow manifest key order, and array values keep their
  order. The projection includes checked soft-deleted rows and empty model sets.
  For a timestamp pinned to `true`, the hash records timestamp presence as
  `true`, so wall-clock changes across resets preserve the fingerprint. Other
  selected fields hash their verified values. Unselected fields and
  out-of-fixture tables are excluded.
- **Manifest SHA-256** hashes the UTF-8 `JSON.stringify(manifest.rows)` from the
  repository, in declaration order. It covers the committed expected rows and
  field pins for drift detection. Manifest metadata such as the version, live
  card count, and out-of-fixture table list is excluded.

## Regression tests

```bash
npm run demo:task176:test
```

Run the opt-in integration suite before merging or rolling out fixture changes.
In GitHub Actions, manually run **CI** with `demo_task176_integration` enabled
to start the `demo:task176:integration` job on dedicated PostgreSQL 16.

To run locally, build the backend and set
`TASK176_INTEGRATION_ALLOW=1` and `TASK176_TEST_DATABASE_URL` for a separate
disposable PostgreSQL cluster. Create `janosik_task176_demo` first. The tests
migrate and reset it and also use `janosik_task183_1_dev` and
`janosik_task183_1_pixel` on the same cluster. They use temporary copies of the
backend with conflicting env files and leave the workspace's env files alone.

```bash
npm run build -w backend
read -rsp 'Disposable integration database URL: ' TASK176_TEST_DATABASE_URL
printf '\n'
export TASK176_TEST_DATABASE_URL
TASK176_INTEGRATION_ALLOW=1 npm run demo:task176:test
```

### Residual verification ledger

- Prisma-process SIGKILL during `migrate reset` was not exercised; the suite
  covers wrapper and wrapper-process-group SIGKILL only.
- The manual `demo:task176:integration` GitHub Actions job has not been run.

Module-boundary nonce validation and configurable database lease or fallback
timeouts are follow-ups.
