# TASK-176 demo fixture

Run these commands from the repository root on Linux or WSL with readable
`/proc`, `flock`, the repository's Node version, and disposable PostgreSQL 16.
Use a separate database or board for manual experiments. The reset works on
the entire target database or the entire fixture/account scope described below.

## Set up the target

Create the disposable database `janosik_task176_demo` with the `public` schema
and apply the current migrations once. The PostgreSQL role needs permission to
create the database if necessary, own or recreate the schema, apply migrations,
and terminate other connections to the demo database. Stop any regular
backends or other jobs using that database before resetting.

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
DATABASE_URL="$DEMO_DATABASE_URL" npm run prisma:deploy -w backend
npm run demo:task176:reset
npm run demo:task176:verify
```

The primary reset runs `prisma migrate reset --force --skip-seed`, which
recreates the demo schema and clears all data there, including global settings
and master accounts. First the wrapper starts a private loopback backend and
proves its database identity with a temporary user, board and accepted ADMIN
membership created through Prisma. The probe signs a short-lived user JWT and
makes a single board GET. A failed probe leaves the fixture untouched. After
marker cleanup and backend shutdown, the wrapper terminates remaining demo
connections and prints their PostgreSQL PIDs. It restarts the backend for the
seed, proves identity again against a fresh connection, and stops and reaps it
before verification.

Each backend boot consumes a private 0600 nonce-bound env file supplied via CLI
flags. Reset boot bypasses `backend/.env`, `.env.<NODE_ENV>` and `.env.local`,
sets `COOKIE_SECURE=false`, and uses the backend's test environment to keep
scheduled jobs off. Regular backend boot continues to load its normal env
files. After a crash, rerun the reset. The wrapper takes a per-database lock,
checks process identity before signaling a stale backend group, and sweeps
stale reset files and identity markers. If ownership is unproven, the reset
fails closed. The persistent lock file is reused by later invocations.

## Keep global settings

```bash
npm run demo:task176:reset -- --fallback
```

The fallback resets fixture data and admin/security accounts in one ordered
transaction. It retains feature flags, mail settings and templates, OAuth
provider settings, operational and throttle settings, and announcements with
their translations. Announcement dismissals cascade when their users are
deleted. Keep the original `SETTINGS_SECRET` in the shell so retained SMTP and
OAuth credentials remain decryptable. If the original `SETTINGS_SECRET` was
empty, keep the original `JWT_SECRET`. If the original key is unavailable,
re-enter the saved credentials in the demo master panel.

An identity probe rejected by saved maintenance mode or throttling aborts
before reset. Use the demo master panel to make the demo backend available for
the probe, then rerun the command.

## Recreate the master account

Both reset modes clear master accounts, admin sessions and admin audit state.
Recreate the first master when admin login is needed. The first master is an
OWNER. Use the hidden prompt, or set `ADMIN_PASSWORD` in the environment for
automation. The wrapper uses the validated demo DSN from the environment.

```bash
npm run demo:task176:admin -- --email owner@example.com
```

Reset and verify print the target host/database, stable fixture identifiers
and verification results. Reset also prints the private API port and process
PIDs. Passwords, complete DSNs, PATs and JWTs stay out of logs and command-line
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
  UUID link, checklist `123` and item `1`. The label toggles are command
  history. The final label attachment is canonical.
- The 60 `t176-comment-*` rows, including the nine soft-deleted rows, belong to
  manual TASK-176.9 testing. The canonical TASK-176 comment set is empty.
- The seed's `run-124` represents a reverted history state in the UI. Its card
  deletion remains applied because the seed stores that status without a
  restore command. The verifier expects the soft-deleted onboarding card.
- Extra registrations, including `1@t.com` and `2@t.com`, fail verification.
  Admin, security, session, notification, reminder and idempotency rows are
  outside the fixture. Run timestamps and other runtime state can change.

The verifier needs only `DEMO_DATABASE_URL`. It uses Prisma in a PostgreSQL
read-only snapshot transaction, with no API login or PAT use, so refresh
tokens and PAT usage timestamps stay untouched. A mismatch reports the model,
expected record and differing field or count. Record that diagnostic and
rerun the reset to repair the fixture.

## Regression tests

```bash
npm run demo:task176:test
```

To include integration tests, build the backend and set
`TASK176_INTEGRATION_ALLOW=1` and `TASK176_TEST_DATABASE_URL` for a separate
disposable PostgreSQL cluster. The tests migrate and reset
`janosik_task176_demo` and also use `janosik_task183_1_dev` and
`janosik_task183_1_pixel` on the same cluster. They use temporary copies of the
backend with conflicting env files and leave the workspace's env files alone.
