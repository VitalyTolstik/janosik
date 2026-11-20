# TASK-183 — Demo fixture hygiene and card label timestamp integrity

**Status:** planned (docs-only roadmap ticket; no production code in this task)  
**Priority:** P2 for demo fixture hygiene; P3 for the label timestamp bug  
**Base:** `main` = `002a31ec`  
**Branch:** `docs/TASK-183-demo-label-integrity`  
**Scope:** the disposable TASK-176 demo fixture and the `SET_CARD_LABEL` card timestamp. No schema, API-contract or UI redesign.  
**Source:** TASK-176 demo investigation, 2026-11-19; code inspection of the seed script, command writers, shared reducer, inverse and focus-diff paths.  
**Related:** TASK-176 demo setup; TASK-156 (label-only `updatedAt` workaround); TASK-150 (focus diff); TASK-21.7d (undo timestamps); TASK-180.7 (demo data lifecycle, coordination only).

---

## 1. Summary

This ticket covers two independent findings from the TASK-176 demo investigation:

1. **The demo database drifted from its committed fixture.** The database
   `janosik_task176_demo` contains manual edits that are not produced by the
   committed seed: a card titled `Card claim visibility 123`, a description
   ending in `фывфыв`, and an extra checklist `123` with item `1`. It also
   contains a `TASK-176 demo` label, a `TASK-176 acceptance` checklist and two
   named TASK-176 links that are not in any committed seed, plus 60
   `t176-comment-*` rows (9 soft-deleted, 51 live). The app-user set has four
   rows: the two seed users plus junk `1@t.com` and `2@t.com`; runtime/admin/
   security rows observed at probe time included 3 `SecurityAuditLog`, 1
   `AttentionNotification`, 51 `RefreshToken`, 1 `AdminUser`, 58
   `AdminRefreshToken` and 67 `AdminAuditLog` (not manifest pins). The board
   aggregate still loads and the API accepts it, so
   this is **not corruption**; it is an unreproducible demo fixture. The
   repository has no TASK-176 seed, reset or verification command, and the
   existing pixel seed does not create the TASK-176-specific fixture rows. A
   clean demo cannot currently be recreated from source, and manual edits
   silently pollute the canonical fixture.

2. **`SET_CARD_LABEL` does not update `Card.updatedAt`.** The shared reducer
   changes `labelIds` but leaves `updatedAt` unchanged
   (`shared/src/store/board-reducer.ts:1267-1308`). The command writer then
   calls `bumpCard`, which writes `new Date(card.updatedAt)` from that
   after-state (`backend/src/commands/command-writers.ts:371-378`). The result
   is a **version bump with a stale timestamp**: the timestamp-only focus-diff
   fast path misses the label change, and the TASK-156 `labelIds` fallback
   masks the stale timestamp instead of fixing it. This is low-severity and
   separate from TASK-176.9.

The two subtasks can ship independently. Both are testable without changing
the board command contract or the admin demo runner.

---

## 2. Finding A — demo fixture hygiene

### 2.1 Observed state

Read-only probe of `http://127.0.0.1:5311` on 2026-11-19, app account
`pixel-admin@example.com`, board `Agent Ops Demo`
(`px-board-agent-ops`):

| Item | Observed in `janosik_task176_demo` | Committed seed output |
| --- | --- | --- |
| Card `px-card-card-claim` title | `Card claim visibility 123` | `Card claim visibility` (`scripts/seed-agent-pixel-demo.mjs:346`) |
| Card description | `API reference sweep — exact MCP transport contract. фывфыв` | `API reference sweep — exact MCP transport contract.` (seed run 126) |
| Checklists | `TASK-176 acceptance` (3 items) **and** `123` (item `1`) | No card checklist is created by the seed |
| Labels | `TASK-176 demo` (`px-label-task176-demo`, pink) attached to the card | No label is created by the seed |
| Card links | `px-link-task176-demo` (relates to `px-card-mcp-write`), `px-link-task176-blocks` (blocks `px-card-approval-inbox`), and a random-UUID `relates_to` link to `px-card-mcp-callouts` | No card link is created by the seed |
| Board aggregate | 200, six live cards on this board, four columns, one label | Twelve live cards total across two boards, four columns per board; no label unless the TASK-176 overlay adds one |

The `TASK-176 acceptance` checklist, the `TASK-176 demo` label and the two
named `px-link-task176-*` links are not junk by definition: they look like the
intended TASK-176 manual fixture. But none of them is in a committed seed, so
the fixture that the team is testing against cannot be rebuilt from the
repository. The `123` checklist, the `123` title suffix, `фывфыв` and the
random-UUID link are manual typing artifacts. The reset/verify work must
classify the whole set, not only the three visible junk strings.

This is not a data-integrity incident:

- the board aggregate returns 200 and validates;
- versions and positions are coherent;
- the API accepted the edits and continues to read them;
- no row is orphaned or unreadable.

The defect is reproducibility: the canonical fixture and the hand-edited
database are different things, and nothing detects the difference.

### 2.2 Complete observed mutation inventory

The public `GET /boards/:id/commands?since=0` delta is **not a complete
audit**: the Agent Ops request returned 46 entries for sequence numbers 1–51.
It is board-scoped — seq 9–13 belong to the Website board — so 46 entries for
one board is expected; do not assert 51 per board. The inventory below combines
that delta, the current card fields, the admin comment list (60
`t176-comment-*` rows: 9 soft-deleted, 51 live), the seed source and direct seed
writes that bypass the command log. Any verifier must use all of these, not only
`Command` rows.

Representative raw probe evidence (command IDs from the Agent Ops delta):

| Seq | Action | Command ID |
| ---: | --- | --- |
| 14 | `ADD_LABEL` | `t176-add-label-mwmij73b-muuj71` |
| 15 | `SET_CARD_LABEL` initial attach | `t176-attach-label-mwmij74a-4y2q4i` |
| 24 | `UPDATE_CARD` description + `фывфыв` | `84283091-d29f-4af8-99fa-b95d037e6eee` |
| 25 | `MOVE_CARD` to `px-col-ops-done` | `1ce3303d-f978-469c-b5bc-29750dc14317` |
| 26 | `UPDATE_CARD` title `…123` | `835eced2-c75f-4869-b972-f395525bb4b0` |
| 29 | `SET_CARD_COVER` yellow | `f1ff934c-ac08-4452-a478-c1848828683b` |
| 41 | `SET_CARD_PRIORITY` blocker | `37a69c95-56e0-4d69-9363-8ce0d7c918b2` |
| 39 | `ADD_CHECKLIST` random `123` | `f238c4b1-9861-4543-af5e-673b7e6eaa51` |
| 40 | `ADD_CHECKLIST_ITEM` item `1` | `9b758ec1-cb48-411f-972f-9e3a217f62ee` |
| 45 | `ADD_CARD_LINK` random UUID | `3cd92bb1-90e4-4af6-b00e-efa28cb586fd` |

| Observed mutation / field | Evidence | Classification | Manifest / verifier action |
| --- | --- | --- | --- |
| Seed commands `px-seed-cmd-*` (runs 128/126/124/121/118/108/115/112/104) | `Command` rows; seed source | Canonical | Expected; verify stable outcomes, not command timestamps. |
| `MOVE_CARD` of `px-card-approval-inbox` to `px-col-ops-done` | seq 1, run 128 | Canonical seed | Verify column/position. |
| Canonical `UPDATE_CARD` description on `px-card-card-claim` | seq 2 | Canonical seed | Exact description. |
| `DELETE_CARD` of `px-card-old-onboarding` | seq 3; run 124 is marked `reverted`, but no restore command exists | Canonical seed data with a **misleading run status** | Verify the card is absent/soft-deleted; document that the run is not a real revert. |
| Landing/MCP seed updates | seq 4–8; seed direct DB title update | Canonical | Verify final stable titles/descriptions. |
| `UPDATE_CARD` title `Card claim visibility 123` | seq 26 | **Junk** | Title must be exactly `Card claim visibility`. |
| `UPDATE_CARD` description suffix `фывфыв` | seq 24 | **Junk** | Description must equal the canonical string. |
| `SET_CARD_ASSIGN` to `px-user-admin` | seq 23 | Manual/undecided | Decide `assigneeId`; if not canonical, verify `null`. |
| `MOVE_CARD` of the fixture card to `px-col-ops-done` index 2 | seq 25 | Manual/undecided | Verify `columnId`/`position`; if not canonical, verify the seed position. |
| `SET_CARD_COVER` yellow | seq 29 | Manual/undecided | Verify `cover`; if not canonical, verify `null`. |
| `SET_CARD_PRIORITY` blocker | seq 41 | Manual/undecided | Verify `priority`; if not canonical, verify default/`null`. |
| `ADD_LABEL` + initial `SET_CARD_LABEL` for `px-label-task176-demo` | `ADD_LABEL` seq 14; initial `SET_CARD_LABEL` seq 15; seed creates no labels | Canonical candidate | Verify exact label ID/name/color and final card label set. |
| 18 additional `SET_CARD_LABEL` toggles on the same label | seq 30–38, 42–44, 46–51; final state is on | **Volatile/noise** | Verify final `labelIds` only; command count is not canonical. |
| `ADD_CHECKLIST` `TASK-176 acceptance` + 3 items | seq 16–19; IDs `px-checklist-task176-demo` / `px-checkitem-task176-*` | Canonical candidate | Verify checklist ID/title/position and all items. |
| `SET_CHECKLIST_ITEM_DONE` for all three acceptance items | seq 20, 27, 28 | Canonical candidate | Verify each item's `done` state. |
| `ADD_CHECKLIST` random UUID `123` + item `1` | seq 39–40 | **Junk** | No checklist titled `123`; no item text `1`. |
| `ADD_CARD_LINK` `px-link-task176-demo` / `px-link-task176-blocks` | seq 21–22 | Canonical candidate | Verify link IDs, types, targets and order. |
| `ADD_CARD_LINK` random UUID to `px-card-mcp-callouts` | seq 45 | **Junk** | No random-UUID link. |
| 60 `t176-comment-*` rows | Admin comments: total 60, 9 soft-deleted, 51 live | TASK-176.9 manual scaffolding, **separate** | Exclude from the TASK-176 canonical fixture unless a dedicated TASK-176.9 fixture is defined; reset removes them. |
| App users | 4 total: the two seed users plus `1@t.com` and `2@t.com` (created 21:40, unverified) | Seed users canonical; the two extras **junk** | Manifest expects exactly two users and their board roles; register an extra user after reset → verify fails. |
| `SecurityAuditLog` (3), `AttentionNotification` (1), `RefreshToken` (51) | Probe counts; runtime/security/session side effects | **Out-of-fixture** | Ignore or assert zero after reset; never use them as fixture success. |
| `AdminUser` (1), `AdminRefreshToken` (58), `AdminAuditLog` (67) | Probe counts; admin/runtime state | **Out-of-fixture**; reset drops admin login | Recreate the master/admin account separately after reset, or define a separate TASK-176.9 admin fixture; do not treat these rows as fixture data. |
| `IdempotencyRecord`, `ReminderSent`, `AnnouncementDismissal` | Present/possible runtime rows; not board fixture | **Out-of-fixture** | Include idempotency/reminder in the narrowed fallback; dismissal cascades with deleted users. Do not present them as canonical. |
| `dueDate`, `acceptanceCriteria`, `definitionOfDone`, `claimedBy`, `leaseUntil`, `archivedAt` | No observed mutating command; seed leaves these unset/empty | Canonical absent unless decided otherwise | Assert absent/empty explicitly; a future value fails verify. |
| Session heartbeats, approval TTL/timestamps, run timestamps/statuses, `createdAt`/`updatedAt` where not listed above | Runtime/volatile | Volatile | Ignore in the fixture manifest except where a stable status is part of the contract. |

The named `t176-*` commands (label attach, acceptance checklist/items, named
links) are the likely canonical TASK-176 overlay. The random UUID commands,
the `123`/`1` checklist, the title/description junk and the 18 extra label
toggles are drift. The assignee/cover/priority/move changes are **undecided**:
they may be intentional manual scenarios or junk; the manifest must state yes
or no for each, and the verifier must enforce that choice. Do not silently
delete them without deciding; do not silently keep them as "canonical" either.

Security/session/admin counts above are **probe-time observations**, not
manifest pins: they change with every login, request and cleanup. The manifest
must not assert `RefreshToken`, `AdminRefreshToken`, `AdminAuditLog`,
`SecurityAuditLog` or `AttentionNotification` counts.

### 2.3 Root-cause research

**The only committed seed is the pixel demo seed.**

`scripts/seed-agent-pixel-demo.mjs`:

- refuses to run without `SEED_ALLOW=1` (`:39-42`);
- deletes demo tables before recreating rows, but the order is incomplete:
  `ChecklistItem`, `Checklist` and `CardLink` are never deleted;
- creates fixed IDs for two boards, eight columns and **13 card rows**: 12 via
  `card.createMany` plus `px-card-expired-retention` through `ADD_CARD` in the
  retention run. Twelve remain live;
- one card is soft-deleted by the seed's `DELETE_CARD` (run 124). That run is
  marked `reverted`, but no restore command exists, so the deletion remains
  applied — the fixture contains a misleading run status;
- creates board `px-board-agent-ops` and card `px-card-card-claim` with
  `title: "Card claim visibility"` (`:341-346`);
- creates the canonical description through the real command transport in
  `seed-run-126` (`UPDATE_CARD` on `ids.cardClaim`);
- creates no card checklists, labels, card links or comments;
- writes runs, approvals, sessions and a JSON summary to stdout.

**Why the current cleanup does not work.** Prisma relations default to
`RESTRICT` (the schema header says app-level cascades are deliberate). The
seed deletes `cardLabel`, then `card`, then `label`, `column`, `board`, but
never deletes:

- `ChecklistItem` and `Checklist` — both reference `Card`;
- `CardLink` — references `Board` and both cards;
- `BoardShare` / `BoardShareAuditLog` — the share FK is `SetNull`, so the
  board delete can succeed while stale shares and audit rows survive; the
  audit log has no FK at all;
- other non-board children such as `DemoRun` / `DataExport` remain by design
  or by accident depending on the table.

On the observed database, `Card.deleteMany()` will fail once a checklist or
card link exists, because the earlier deletes have already committed and the
FK is restrictive. The current “wrapper” cannot be trusted; the reset must
either (a) drop and recreate the demo schema/database and apply migrations, or
(b) run an explicitly ordered, transactional delete covering every dependent
table and add a regression that resets twice after adding a checklist and a
link. Recommendation: (a) for a disposable demo database.

The seed is designed for a **disposable** database and warns “never the live dev
DB” in its header, but the only hard guard is `SEED_ALLOW=1`. It does not:

- validate that `DATABASE_URL` points at a demo database;
- create or migrate the database;
- verify the fixture after seeding;
- distinguish a base pixel fixture from a TASK-176 acceptance fixture;
- provide a package script, reset command or cleanup path.

**No TASK-176-specific fixture is committed.**

- `grep` across the current tree finds no `janosik_task176_demo`,
  `TASK-176 acceptance`, `px-checklist-task176-demo` or
  `px-checkitem-task176` references.
- `package.json` exposes `demo:swarm` and `demo:100`; those drive load
  against an existing board, not a deterministic fixture. It has no seed/reset/
  verify script for the pixel/TASK-176 fixture.
- The pixel parity documentation (`design/task-179-visual-acceptance/pixel-parity/README.md`)
  documents a manual environment invocation, not a repeatable developer
  command.

Therefore the `TASK-176 acceptance` checklist, label and named links were
added by hand or by an untracked script. Even if the seed's cleanup succeeded,
it would delete the intended TASK-176 label/checklist/links along with the junk;
in practice it can fail on the missing checklist/link deletes. The current
reset path is therefore both unsafe (loses intended fixture) and unreliable
(FK `RESTRICT`).

**The admin demo runner is a different system.**

`backend/src/admin/demo.service.ts` is the TASK-57/TASK-69 admin demo. It has
its own manifest and cleanup path, but it is not a safe pattern to copy: its
known H9 gaps include over-broad `CardLink` deletion and a title-prefix purge
that can hit a user board. TASK-180.7 owns those fixes. This ticket must not
repurpose the runner, change its semantics or rely on its cleanup as the
fixture reset.

### 2.4 Proposed cleanup/reset path

**Recommended: commit the fixture, add an explicit reset/verify command, and
never rely on manual SQL.**

1. **Commit the canonical TASK-176 fixture.** Decide whether the
   `TASK-176 acceptance` checklist, the `TASK-176 demo` label and the named
   `px-link-task176-*` links are intended. Also decide the observed
   assignee/cover/priority/move values and the `t176-comment-*` set (§2.2). If
   canonical, add them to a committed fixture manifest and seed deterministically.
   If not, remove them from the canonical fixture and document that they were
   manual scaffolding. Do not reset the current database before that decision.

2. **Add a fixture manifest.** A small `scripts/fixtures/task176-demo.json` (or
   an exported object module) lists the stable fixture contract:
   board IDs/titles, column IDs/titles, card IDs/titles, the canonical
   description, expected app users and board roles, intended label IDs/names,
   checklist IDs/titles/items, card-link IDs/types/targets, `columnId`/`position`,
   `priority`, `assigneeId`, `cover`, explicit `dueDate`/task-spec/claim/
   `archivedAt` decisions, the comment-set decision, the out-of-fixture
   classification for security/admin/session rows and expected counts. Seed and
   verify both read the same manifest so they cannot drift.

3. **Add a reset command.** Example:
   `npm run demo:task176:reset`. It should:
   - require an explicit `DEMO_DATABASE_URL` and `DEMO_API_URL` with **no
     defaults**; `DEMO_API_URL` must be loopback and an owned/free port (or the
     reset allocates/prints it), and a port already in use is refused;
   - refuse conflicting `DATABASE_URL` / `API_URL` values instead of silently
     preferring one;
   - resolve one database URL, print only its host and database name, and pass
     it as `DATABASE_URL` to every child process (Prisma, migrations, seed and
     backend). Keep the exact `janosik_task176_demo` name as the primary guard;
     a `*_demo` wildcard is allowed only with an extra explicit allow flag;
   - **force the URL past backend env precedence, without touching
     `.env.local`.** `backend/src/config/env.ts:21-32` loads `.env`,
     `.env.${NODE_ENV}` and `.env.local` with `dotenv.config({ override: true })`,
     so a shell `DATABASE_URL` can be silently replaced by a dev
     `backend/.env:6`. Snapshot `process.env` **before any dotenv call** and pass
     reset mode/path/nonce **only as CLI arguments** to the backend:
     `--demo-reset`, `--demo-reset-env-file=<absolute path>`,
     `--demo-reset-nonce=<nonce>`. Read `NODE_ENV` from the pre-dotenv snapshot,
     not from the loaded `.env`; never read the reset controls from `.env`.
     The env file is unique per run, 0600, created in a private temp dir with a
     nonce-bearing name (never a predictable path with `JWT_SECRET`), and its
     nonce must match the CLI nonce. Missing/mismatched file aborts the reset;
     normal boot ignores the hook entirely. If the pre-dotenv `NODE_ENV` is
     `production` while reset mode is requested, fail closed and refuse.
     Do **not** use a `.env.local` fallback: a crash could leave it behind and
     silently redirect normal dev boot to the demo DB. Sweep stale reset
     env/temp/lock files at reset start. Add a tampered-`.env` test with
     conflicting `JANOSIK_*`/`NODE_ENV=development` values; the CLI/snapshot must
     win;
   - require `SEED_ALLOW=1` or `DEMO_RESET_ALLOW=1`;
   - verify the backend really reads the demo DB **before deleting**. `/health`
     reports only `db: up`, not identity. Create the marker **directly through
     the reset-owned Prisma connection against the validated demo DB**: a
     marker `User`, a marker `Board`, and an accepted `BoardMember` with role
     `ADMIN`. Mint a user JWT with
     `{ sub, aud: "janosik-user", stamp, exp }` using the reset-env
     `JWT_SECRET` (`JwtStrategy` checks the audience and stamp). Compute
     `stamp` with a **parameterized** `securityStamp(user, secret)` or the same
     HMAC directly from the reset secret; do not import the env-bound helper
     that reads dev `env.JWT_SECRET`. Use the API only for
     `GET /boards/:marker`; any non-200 aborts. Delete marker rows before the
     drop and in `finally`, and sweep stale `task176-marker-*`/`t176-marker-*`
     rows at reset start. After `migrate reset`, use a fresh connection/state
     for marker cleanup. Do not create markers through `DEMO_API_URL`; that
     would be self-fulfilling and prove nothing;
   - **own the backend lifecycle under crashes.** Run the backend in its own
     process group, persist PID/port/lock files per demo DB, and take a reset
     lock so two resets cannot run concurrently. On reset start detect and kill
     a stale reset-owned backend before doing anything else; verify ownership
     from `/proc/<pid>` (Linux/WSL prerequisite) or a fail-closed `ps` fallback
     with the same PID/start-time/port/nonce proof; if unproven, never kill.
     Terminate remaining demo-DB connections before the drop (for example
     `pg_terminate_backend` for that database), **excluding the reset’s own
     backend PID**, and print the terminated PIDs/database only; use a unique
     private port, stop the backend before `prisma migrate reset`, restart it
     after migrations for the seed only, stop it before the Prisma-only verifier,
     and stop it in `finally` — wait for process exit, kill the group if needed,
     and include the lifecycle in the reset-twice and SIGKILL-crash regressions.
     The post-seed backend must not be left running;
   - reset by dropping/recreating the demo schema and applying existing
     migrations (`prisma migrate reset --force --skip-seed` against the guarded
     database), then run the seed and fixture verifier. Primary resets the
     **whole demo database**, including admin/security and global settings; the
     master account is recreated separately. If product rejects schema reset,
     the fallback is a **fixture + admin/security account reset**, not a full
     demo-DB reset: global settings and announcements are retained. Use one
     explicit ordered transaction for
     `ChecklistItem → Checklist → CardLink → CardLabel → Comment → Attachment →
     Activity → CommandPreimage → Command → AgentRun → ApprovalRequest →
     AgentSession → ApiToken → AttentionNotification → BoardShareAuditLog →
     BoardShare → Card → Label → Column → BoardMember → Board → DemoRun →
     DataExport → ReminderSent → IdempotencyRecord → SecurityAuditLog →
     RefreshToken → User → AdminAuditLog → AdminRefreshToken → AdminUser`.
     Retain `FeatureFlag`, `EmailSettings`, `EmailTemplate`, `OpsSettings`,
     `ThrottleSettings`, `Announcement` and `AnnouncementTranslation`.
     `AnnouncementDismissal` is not explicitly deleted; any rows for deleted
     users cascade with the `User` FK. Because `EmailSettings` is retained, the
     reset env must reuse the original `SETTINGS_SECRET` (or original
     `JWT_SECRET` when `SETTINGS_SECRET` is empty), otherwise saved SMTP
     passwords become undecryptable; document re-entry as the fallback. This
     order is FK-correct for the listed tables; the earlier failure was the
     **missing** tables, not the ordering.
     Both primary and fallback remove admin/security account state, so the
     master account must be recreated after either path. Add the reset-twice
     regression below, with non-zero rows in the fallback tables before **each**
     run;
   - exit non-zero on any mismatch, leaving the operator with a clear message
     that the database is partial and the reset must be rerun.

   The TASK-176 seed/overlay (for example `scripts/seed-task176-demo.mjs`)
   must apply the same `DEMO_DATABASE_URL` / `DEMO_API_URL` guard. It reads
   `DEMO_*` exclusively, validates the database name **before** constructing
   `PrismaClient`, and refuses ambient `DATABASE_URL`/`API_URL` mismatches. It
   is invoked **only by the reset wrapper** with a reset-issued one-time nonce;
   a direct invocation is refused, so a standalone overlay cannot trust
   `DEMO_API_URL`. If product insists on a direct mode, that mode must perform
   the same marker identity probe before seeding; a divergent API must fail
   before any write. If the overlay delegates to the base pixel seed, it sets
   `DATABASE_URL=DEMO_DATABASE_URL` and `API_URL=DEMO_API_URL` only after
   validation. The base `seed-agent-pixel-demo.mjs` contract remains supported
   for pixel parity; it gains the same equality check when `DEMO_*` are present,
   and its `PrismaClient` construction moves after the guard. Base pixel seed
   accepts **only** `janosik_pixel` / `*_pixel` and must explicitly reject
   `janosik_task176_demo`; `*_demo` is allowed only through the overlay/reset
   nonce path. Its docs must say `DEMO_*` stays unset for pixel parity. Direct
   base seed invocation is documented as pixel-parity only, not a TASK-176
   reset path; the reset command refuses it. Do not add a destructive HTTP
   endpoint.

   Run from the repository root via the npm script (the script resolves cwd
   explicitly). Document that the reset role needs schema/database create-drop
   privileges for `prisma migrate reset`, and that `prisma migrate reset`
   clears admin/security tables while the seed does not recreate admin users:
   the operator recreates the master account separately or an explicit admin
   fixture is defined.

   The seed/reset output must be captured and redacted: no raw PATs,
   passwords or connection strings on stdout/CI logs. The base seed currently
   prints `tokens` and `login.password`; default output should contain only
   stable IDs, board/run IDs and counts, with raw secrets available only via an
   explicit 0600 file if parity tooling truly needs them.

4. **Add a verify command.** Example:
   `npm run demo:task176:verify`. It must be read-only and assert the manifest
   against the live database:
   - `px-card-card-claim.title === "Card claim visibility"`;
   - the canonical description is exact (no `фывфыв` suffix);
   - the checklist set is exactly the expected set (no `123`/`1`);
   - the label set and card-link set match the manifest (no random-UUID link,
     no missing `TASK-176 demo` label or named TASK-176 links);
   - the fixture card's `columnId`/`position`, `priority`, `assigneeId`,
     `cover`, `dueDate`, `acceptanceCriteria`, `definitionOfDone`, claim fields
     and `archivedAt` match the manifest's explicit yes/no decision;
   - expected boards/columns/cards/checklists/labels/links exist;
   - no unexpected card title, description, checklist, label or link on the
     fixture card;
   - the `t176-comment-*` set is either absent (canonical TASK-176 fixture) or
     exactly the separately declared TASK-176.9 fixture; never silently
     ignored.

   The verifier must be genuinely read-only and **Prisma-only**: no email/password
   login, no PAT use, no `ApiToken.lastUsedAt` mutation and no API session
   write. The reset's separate identity probe may use the marker token; that
   token is deleted with the marker rows and is not part of the fixture. If a
   future API read is unavoidable, ignore `ApiToken.lastUsedAt` and re-mint a
   known token after reset; never log credentials or tokens.

5. **Document the workflow.** Add a short `docs/DEMO-FIXTURES.md` (or a section
   in the existing pixel parity README) with:
   - the database name, `DEMO_DATABASE_URL`, `DEMO_API_URL` and the no-default
     rule;
   - the reset command and its destructive schema-recreate nature, run from the
     repository root;
   - the backend build/env bootstrap the reset uses: `backend/dist/main.js`
     built, `JWT_SECRET`, `SETTINGS_SECRET` (or the original `JWT_SECRET` when
     empty), `PUBLIC_ORIGIN`, `COOKIE_SECURE=false`, a fresh `PORT`, `NODE_ENV`,
     the reset-only env file and the initial `prisma migrate deploy`; the exact
     DB name primary guard and privileges for initial DB creation,
     schema/database create-drop and `pg_terminate_backend`;
   - the fact that both the schema reset and the narrowed fallback clear
     admin/security account state and the seed does not recreate admin users:
     recreate the master with `npm run demo:task176:admin -- --email <master>`
     (the **only documented path**; first master becomes OWNER,
     `ADMIN_PASSWORD` for non-interactive use). The wrapper passes
     `DEMO_DATABASE_URL` via a 0600 env file or child env, never argv. If
     `admin-cli.cjs` keeps `--database-url`, it must reject credential-bearing
     URLs in argv and require `DEMO_DATABASE_URL` from the environment; parse
     args and construct `PrismaClient` **after** dotenv. Test: `backend/.env`
     points at dev, reset env/demo URL at demo → master is created in demo; the
     URL/password never appears in argv, `ps`, stdout or logs;
   - the verify command and its Prisma-only, read-only guarantee;
   - the rule that the canonical demo is reset-only and manual experiments use
     a cloned database or a separate board;
   - that the fallback is a **fixture + admin/security account reset**, not a
     full demo-DB reset; global settings/announcements are retained;
   - that retained `EmailSettings` needs the same `SETTINGS_SECRET` (or original
     `JWT_SECRET` when empty) in the reset env so saved SMTP passwords stay
     decryptable; otherwise re-enter them;
   - the redaction rule: no raw tokens, passwords or connection strings in
     stdout/CI; raw secrets only via an explicit 0600 file if parity tooling
     needs them;
   - what to do when the verifier fails (capture the diff, reset, do not patch
     rows by hand).

6. **Optional: template/clone isolation.** For teams that run many manual
   sessions, document `CREATE DATABASE janosik_task176_demo_<suffix> TEMPLATE
   janosik_task176_demo_template` (or a scripted equivalent) so each session
   starts from a clean template and can be discarded. This is an alternative to
   resetting one shared database, not a requirement for the first fix.

**Do not** add a targeted `DELETE FROM Checklist WHERE title = '123'` cleanup.
Manual drift can add arbitrary rows; a deterministic fixture reset plus a
verifier is the only maintainable path.

### 2.5 Acceptance criteria — demo hygiene

1. A fresh developer can recreate the TASK-176 demo database from committed
   source with one documented command from the repository root after the
   documented prerequisites.
2. The seed produces 13 card rows and 12 live cards, with stable IDs and exact
   stable values: board/column/card titles, the `px-card-card-claim`
   description, the intended label/checklist/card-link sets, and the expected
   two app users with their board roles (`pixel-admin@example.com` ADMIN on
   Agent Ops / MEMBER on Website, `pixel-member@example.com` the reverse).
   The manifest pins `columnId`/`position`, `priority`, `assigneeId` and
   `cover`, and explicitly declares `dueDate`, task-spec, claim and
   `archivedAt` absent/empty.
3. Reset is rerunnable: running it twice, after first adding a checklist and a
   card link and with non-zero rows in `SecurityAuditLog`, `IdempotencyRecord`,
   `ReminderSent`, `AdminUser`, `AdminRefreshToken` and `AdminAuditLog` (plus a
   dismissal for a seed user), succeeds and returns the same stable fixture.
   Global flags/mail/templates/ops/throttle/announcements are retained; the
   dismissal cascades with the user. The reset-owned backend is stopped and
   reaped between runs; no open connection blocks the next schema drop.
4. The reset forces the demo URL **past backend env precedence**
   (`env.ts` `.env`/`.env.NODE_ENV`/`.env.local` with `override: true` even when
   `backend/.env:6` points at dev), uses one resolved DB URL for every child,
   starts the backend on a fresh private port, stops it before the drop, starts
   it again for seeding, stops it before the Prisma-only verify and guarantees
   stop/reap in `finally`. `DEMO_API_URL` is loopback and an owned/free port (or
   reset-allocated), and an occupied port is refused. The path/nonce come from
   CLI/pre-dotenv env, not a `.env` file. A test starts with `backend/.env`
   pointing at dev and `DEMO_DATABASE_URL` at the demo DB.
5. Before any delete, the reset proves the API reads the demo DB with a real
   identity probe: marker user, board and accepted ADMIN `BoardMember` created
   directly via the reset Prisma connection; JWT
   `{ sub, aud: "janosik-user", stamp, exp }` minted with the reset-env
   `JWT_SECRET`, where `stamp` is the parameterized `securityStamp(user, secret)`
   (not the env-bound dev helper); only `GET /boards/:marker` goes through the
   API. Correct DB → 200; any non-200 (401/403/404) aborts. `/health` `db: up`
   alone is not accepted. Markers are cleaned before the drop, in `finally`, and
   swept at start; post-reset cleanup uses a fresh connection/state.
6. The TASK-176 seed/overlay uses `DEMO_DATABASE_URL`/`DEMO_API_URL`
   exclusively, validates the DB name before constructing `PrismaClient`, and
   refuses ambient `DATABASE_URL`/`API_URL` mismatches. It runs only under the
   reset wrapper with a one-time nonce; direct invocation is refused, and a
   divergent API cannot write. The base pixel seed still works for parity,
   accepts only `janosik_pixel`/`*_pixel`, explicitly rejects
   `janosik_task176_demo`, and only adds the equality check when `DEMO_*` are
   present; `DEMO_*` stays unset for pixel parity. Direct base-seed invocation
   is not a TASK-176 reset path.
7. `demo:task176:verify` passes after reset, is Prisma-only and truly read-only
   (no login, no PAT, no `ApiToken.lastUsedAt` mutation), and checks the full
   manifest including users/roles, comments policy and the out-of-fixture
   classification. Registering an extra user after reset fails verify.
8. `demo:task176:verify` fails on the observed junk: `Card claim visibility 123`,
   `фывфыв`, checklist `123`/`1`, random-UUID link, and any undecided
   assignee/cover/priority/move value that does not match the manifest.
9. Both primary and fallback remove admin/security account state; the docs
   require master recreation with
   `npm run demo:task176:admin -- --email <master>` (the only documented path;
   URL via 0600 env/child env, not argv; first master OWNER) against the demo
   DB. Runtime/admin/security rows are out-of-fixture, not canonical. The
   fallback is **fixture + admin/security account reset**;
   `FeatureFlag`, `EmailSettings`, `EmailTemplate`, `OpsSettings`,
   `ThrottleSettings`, `Announcement` and `AnnouncementTranslation` are
   retained. `AnnouncementDismissal` is not explicitly deleted; rows for deleted
   users cascade.
10. A manual edit followed by a reset restores the canonical fixture; the
    intended TASK-176 label, acceptance checklist and named links are not lost.
    The 60 `t176-comment-*` rows are absent or moved to a separately declared
    TASK-176.9 fixture; they are not silently ignored.
11. Reset/seed output is redacted: no raw PATs, passwords or connection strings
    in stdout/CI logs; raw secrets only via an explicit 0600 file if parity
    tooling needs them. No admin demo-runner code, production database or
    non-demo developer database is touched.

### 2.6 Normal path and recovery

**Normal path (one command, repo root):**

```bash
npm run demo:task176:reset
npm run demo:task176:admin -- --email <master>   # only if admin login is needed
```

The reset prints host/database only, allocates/checks the private API port,
writes the 0600 reset env, runs the identity probe, resets/seeds, verifies and
reaps the backend. The admin wrapper passes the DB URL via env/file, never
argv. `npm run demo:task176:verify` is the read-only check if a human wants a
second opinion; no login is involved.

**Recovery after a crash/SIGKILL:**

Rerun `npm run demo:task176:reset`. At start it sweeps stale reset env/temp/lock
and marker rows, proves process ownership from PID/start time/command
line/port/nonce, kills only that reset-owned group and terminates remaining
demo-DB connections before the drop. If ownership cannot be proven, it clears
stale bookkeeping and fails closed with the stale PID/lock path printed; do not
kill a process by hand and do not patch rows. A partial schema is recovered by
rerunning the same reset. Linux/WSL is the supported environment for the
`/proc` ownership check; on other platforms the reset either uses a fail-closed
`ps` fallback or refuses with a clear prerequisite message.

Manual test edits remain reset-only: run the reset before/after a session; do
not hand-edit the canonical demo rows.

---

## 3. Finding B — `SET_CARD_LABEL` does not bump `Card.updatedAt`

### 3.1 Observed contract

A label attach/detach:

- changes `Card.labelIds`;
- increments `Card.version` (the writer's `bumpCard` does this);
- updates `lastActorId`;
- **does not advance `Card.updatedAt`**.

The aggregate and the UI therefore show a card whose visible label set changed
but whose “Updated” timestamp did not. `version` still changes, so CAS and
command idempotency are not broken; the defect is the card's update timestamp,
not the write itself. It is low severity but a real consistency bug.

### 3.2 Root cause

The chain is:

1. `shared/src/store/board-reducer.ts:1267-1308` — `setCardLabel` computes
   `nextCard` with the new `labelIds` and appends the label activity, but does
   not set `updatedAt`.
2. `backend/src/commands/command-writers.ts:973-978` — `SET_CARD_LABEL` writes
   the join rows and calls `bumpCard(tx, card, ctx.actorId)`.
3. `backend/src/commands/command-writers.ts:371-378` — `bumpCard` writes
   `updatedAt: new Date(card.updatedAt)`, deliberately trusting the reducer's
   after-state so an inverse can restore the previous timestamp via
   `cardUpdatedAt`.

Because step 1 leaves the old value in place, step 3 writes the old value back.
`version` is incremented in the same update, which exactly matches the reported
“only `version` changed” behaviour.

The writer's comment says this is “the bookkeeping every label/checklist
command does on the card it edits (the reducer's `cardStamp`, including inverse
`cardUpdatedAt`)”. `setCardLabel` is the exception that violates that
assumption.

**The inverse has the same omission.** `shared/src/store/invert.ts:449-462`
builds the inverse `SET_CARD_LABEL` with `cardActivity` and the previous label
index, but does not carry `cardUpdatedAt: card.updatedAt`. Once the reducer
starts stamping `updatedAt`, an undo must also carry the previous timestamp, or
the undo will write the undo time instead of restoring the pre-change state.

**Validation drops the inverse stamp even if invert supplies it.**
`shared/src/store/validate.ts:61-90` defines `CARD_STAMPED_TYPES` — the only
command types for which an inverse may carry `cardUpdatedAt`. `SET_CARD_LABEL`
is absent; `CARD_ACTIVITY_REWIND_TYPES` includes it only for `cardActivity`.
At `:377-389`, the inverse override is therefore dropped before the reducer or
writer sees it. Adding `cardUpdatedAt` to `invert` without adding
`"SET_CARD_LABEL"` to `CARD_STAMPED_TYPES` would be a silent no-op on undo.

**The UI already works around it.** `ui/src/store/board-diff.ts:58-70` compares
`labelIds` explicitly because label-only changes can have the same
`updatedAt`; `ui/src/store/board-diff.test.ts:123` codifies that behaviour as
“reports a label-only card change with an equal `updatedAt` (TASK-156)”. The
`updatedAt`-only fast path would miss the label change; the `labelIds` fallback
masks the stale timestamp rather than fixing it.

### 3.3 Audit of other card-content actions

The audit should not stop at `SET_CARD_LABEL`. The writer/reducer pair has a
clear invariant: **every command that changes card content must put the
command's card stamp into the reducer's after-state; the writer then persists
that exact stamp.** The following table records the initial audit; the
implementation must turn it into tests or a documented decision.

| Action / area | Reducer stamps card `updatedAt`? | Writer bumps card? | Verdict |
| --- | --- | --- | --- |
| `SET_CARD_LABEL` | **no** | yes (`bumpCard`, old value) | **Bug — fix.** |
| `ADD_CARD_LINK` / `REMOVE_CARD_LINK` | yes (`cardStamp`) | yes (`bumpCard`) | OK. |
| `ADD/RENAME/DELETE_CHECKLIST` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `ADD/RENAME/DELETE_CHECKLIST_ITEM` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `RESTORE_CHECKLIST` / `RESTORE_CHECKLIST_ITEM` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `UPDATE_CARD` / `TOUCH_CARD` | yes (`cardStamp`; quiet path keeps old until touch) | direct write | OK; verify quiet/touch tests. |
| `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`, `SET_CARD_ASSIGN`, `CLAIM_CARD`, `SET_CARD_TASK_SPEC` | yes (`cardStamp`) | direct write | OK. |
| `SET_CARD_COVER` | yes (`cardStamp`) | direct write | OK. |
| `MOVE_CARD`, `ARCHIVE_CARD`, `UNARCHIVE_CARD`, `DELETE_CARD`, `RESTORE_CARD`, `DUPLICATE_CARD` | yes / explicit timestamps | direct write | Verify in the regression matrix; no same-shape omission found. |
| `DELETE_LABEL` | **was no** on every card that loses the label | **was no `bumpCard`** | **Fixed in TASK-183.3 — stamps every affected card; inverse carries per-card stamps.** |
| `RESTORE_LABEL` | **was no** on every card that regains the label | **was no `bumpCard`** | **Fixed in TASK-183.3 — restores each card's `updatedAt`; a pre-183.3 inverse falls back to the command stamp.** |
| `RENAME_LABEL` / `SET_LABEL_COLOR` | label metadata only; card content unchanged | no card bump | Intentional; document why and pin with an e2e regression. |
| `ADD_LABEL` | no existing card changes | no card bump | Intentional. |

**TASK-183.2 implementation (2026-11-20).** `SET_CARD_LABEL` now stamps each
attach or detach, and its inverse restores the previous stamp. Shared and
backend tests cover the exact timestamps, including undo through the command
endpoint. The UI focus diff uses the stamp first and retains the TASK-156
label-array check for compatibility.

**TASK-183.3 implementation (2026-11-21).** `DELETE_LABEL` now stamps every
card whose `labelIds` it changes with the command's card stamp, and its inverse
`RESTORE_LABEL` carries each card's previous `updatedAt` in
`assignments[].updatedAt`; the reducer applies that per-card stamp and the
writer calls `bumpCard` once per affected card (version +1, `lastActorId` set).
A pre-183.3 inverse without `updatedAt` still validates and falls back to the
restore's command stamp — exact historical restoration is not possible without
that data, but the undo keeps working and no schema or API break is introduced.
`invert(RESTORE_LABEL)` likewise records the pre-restore per-card stamps in an
inverse-only `DELETE_LABEL.cardStamps`, so undo stays byte-exact. The same-class
audit found no other gap: `SET_CARD_LABEL` is single-card and already stamps
(183.2); `RENAME_LABEL`/`SET_LABEL_COLOR` change label metadata only and
deliberately do not touch cards, covered by an e2e regression.

### 3.4 Proposed fix

**Primary, required:**

1. In `setCardLabel`, stamp the next card with `updatedAt: cardStamp(action)`.
   This is the same helper used by the other card-content actions and respects
   inverse `cardUpdatedAt`.
2. In `invert` for `SET_CARD_LABEL`, add
   `cardUpdatedAt: card.updatedAt` so undo restores the pre-change timestamp.
3. Add `"SET_CARD_LABEL"` to `CARD_STAMPED_TYPES` in
   `shared/src/store/validate.ts` so the inverse override survives validation.
   Add a `validate.test.ts` case that an inverse `SET_CARD_LABEL` with
   `cardUpdatedAt` is accepted unchanged, and that a non-inverse command still
   drops it.
4. Keep `bumpCard` as-is for `SET_CARD_LABEL`; it will now persist the new
   stamp and increment version exactly once.
5. Update the `board-diff` comment and the “equal `updatedAt`” test to describe
   the new contract. Retaining the `labelIds` comparison is acceptable as a
   defensive compatibility check for rows written by older servers; it should
   no longer be the only way a label-only change is detected.
6. Add a reducer test that asserts `updatedAt`/`labelIds` in the after-state,
   and a separate persistence/integration test that asserts the database row's
   `updatedAt`, `version = previous + 1`, `lastActorId = actor` and
   `labelIds = after-state`. Do not assert server-only fields on the shared
   `Card` reducer state (it has no `version`/`lastActorId`).

**Same-class decision:**

7. TASK-183.3 implements the board-wide case: forward `DELETE_LABEL` stamps
   every affected card (`updatedAt` and `version`) while deleting their label
   links; the inverse `RESTORE_LABEL` carries each card's pre-delete
   `updatedAt` in `assignments`, validated as an optional field. A pre-183.3
   inverse without it is accepted and falls back to the restore's command
   stamp. `invert(RESTORE_LABEL)` keeps undo exact through the inverse-only
   `DELETE_LABEL.cardStamps`.
8. Do not change `RENAME_LABEL`/`SET_LABEL_COLOR` card timestamps: they are
   label metadata, not card membership. The e2e audit test asserts the card
   row is untouched.

### 3.5 Acceptance criteria — label timestamp

1. Attaching or detaching a label sets the reducer card's `updatedAt` to the
   command's card stamp (`action.at`, or the inverse `cardUpdatedAt`) and
   changes only that card's `labelIds`.
2. The persisted database row has `updatedAt = reducer after-state`,
   `version = previous + 1`, `lastActorId = actor` and
   `labelIds = reducer labelIds`. The shared reducer state is not asserted to
   contain `version` or `lastActorId` — those are server-only fields written by
   `bumpCard`.
3. Undo of a label attach/detach restores the previous `updatedAt` exactly,
   including through validation and `POST /commands`; redo advances it again by
   the command stamp.
4. A no-op label command (unknown label, or already in the requested state)
   changes neither `updatedAt` nor `version`.
5. `SET_CARD_LABEL` no longer needs the label-only branch in `board-diff` to
   detect a change; if the branch is retained for compatibility, its comment
   and test say why.
6. The audit table in §3.3 is reflected in tests or a recorded decision; every
   card-content action is either verified or explicitly deferred.
7. `DELETE_LABEL`/`RESTORE_LABEL` are either fixed with per-card timestamps
   (forward stamping all affected cards; inverse restoring each card's previous
   timestamp) and tested for exact undo, or split into a named follow-up with a
   test proving the current gap and a note in this ticket.
8. No change to label rename/color semantics, no schema change, no new required
   field and no forward-contract break for `SET_CARD_LABEL`, and no version/CAS
   regression.
9. The existing UI “Updated” surfaces show the new timestamp after a label
   change, and a second tab/focus refetch sees the change.

---

## 4. Subtasks

| ID | Title | Priority | Scope |
| --- | --- | --- | --- |
| 183.1 | Demo fixture manifest, reset and verify | P2 | Commit the TASK-176 fixture, complete mutation manifest, drop/recreate or narrowed fallback, env-precedence/API-binding/identity guards, crash-safe lifecycle, redaction, read-only verify, docs. No admin demo-runner changes. |
| 183.2 | Label timestamp consistency | P3 | Fix `SET_CARD_LABEL` reducer + inverse + `CARD_STAMPED_TYPES`, split reducer/persisted-row tests, audit same-class label writers. |
| 183.3 | Board-wide label timestamps | P3 | Stamp every card on `DELETE_LABEL`; carry per-card previous `updatedAt` in `RESTORE_LABEL.assignments` with a backward-compatible fallback; exact multi-card undo, version/CAS and label-metadata audit tests. |

183.1 is independent of the label work and can ship in its own PR. 183.3 builds
on 183.2 (single-card `SET_CARD_LABEL`) but is separately revertable; both share
the board reducer/command-writer contract and no schema change.

---

## 5. Tests

### 183.1 — demo fixture

- Seed/verify unit tests (Node test runner, no database required for the
  manifest shape): manifest includes the expected app users/roles,
  card/checklist/label/link IDs and the column/position, priority, assignee,
  cover and explicit dueDate/spec/claim/archived fields; verifier rejects a
  title suffix, a `фывфыв` description, an unexpected checklist, an unexpected
  label, a random-UUID link and a mismatched field.
- Integration test against a disposable database: reset → verify passes; add
  a checklist **and** a card link; reset again → must succeed (no FK
  `RESTRICT` failure) and verify passes.
- Fallback reset test: seed non-zero `SecurityAuditLog`, `IdempotencyRecord`,
  `ReminderSent`, `AdminUser`, `AdminRefreshToken`, `AdminAuditLog` rows **before
  each run**; seed `FeatureFlag`/`EmailSettings`/`EmailTemplate`/`OpsSettings`/
  `ThrottleSettings`/`Announcement`/`AnnouncementTranslation` and a dismissal for
  a seed user. Reset twice; no FK failure, admin/security rows are cleared,
  global settings/announcements are retained, the dismissal cascades with the
  user, and the documented master-recreation step is required after both runs.
  With a retained `EmailSettings` row, use the same reset `SETTINGS_SECRET` (or
  original `JWT_SECRET`) and assert the SMTP secret stays decryptable; otherwise
  assert the documented re-entry path.
- Admin-CLI test: `backend/.env` points at dev, reset env/`DEMO_DATABASE_URL` at
  demo; `demo:task176:admin` creates the master in demo, not dev; first master
  becomes OWNER. The URL/password must never appear in argv, `ps`, stdout or
  logs; if `--database-url` remains, a credential-bearing argv value is
  rejected and `DEMO_DATABASE_URL` must come from env.
- Env precedence test: `backend/.env` points at dev `janosik`, `DEMO_DATABASE_URL`
  points at demo, `DEMO_API_URL` at the reset backend; the reset must prove the
  backend read the demo DB, not dev. A divergent-env seed test sets
  `DATABASE_URL`/`API_URL` to different values and expects refusal.
- Direct-overlay test: invoking the TASK-176 seed/overlay without the
  reset-issued nonce is refused; a direct run with `DEMO_DATABASE_URL=demo` and
  `DEMO_API_URL=dev` must fail API-identity or be refused before any write.
- Production/tampered-env test: a `.env` with conflicting `JANOSIK_*` and
  `NODE_ENV=development` cannot disable/redirect reset; CLI args + pre-dotenv
  `NODE_ENV` win. With pre-dotenv `NODE_ENV=production` and reset flags, reset
  is refused; normal boot does not adopt the demo DB. Missing/non-matching
  nonce aborts; stale reset env/lock/temp files are swept at reset start.
- Identity test: create marker user/board/accepted ADMIN `BoardMember` through
  the reset Prisma connection against the validated demo DB; mint the JWT with
  `aud: "janosik-user"` and a stamp computed from the reset-env `JWT_SECRET`.
  Correct DB `GET /boards/:marker` returns 200; **any non-200** (401/403/404)
  aborts before any delete. Markers are cleaned before the drop and in
  `finally`; `finally` must tolerate a missing table/recreated schema and fall
  back to the stale-marker sweep. After `migrate reset` use a fresh
  connection/state.
- `securityStamp` test: the one-argument form keeps using `env.JWT_SECRET` for
  auth callers; the two-argument `securityStamp(user, secret)` uses the provided
  reset secret and matches the expected HMAC. Both paths are tested; the reset
  never imports the env-bound value.
- Lifecycle/ownership test: reset-twice starts a fresh private-port backend
  each time, stops it before the schema drop, stops it after seed and before the
  Prisma-only verify, waits for exit and leaves no process/connection behind.
  A second concurrent reset is refused by the reset lock. A stale PID pointing
  at a live non-reset process must not be killed; ownership is checked from
  PID + start time + process group/session + command line/port/nonce; if
  unproven, clear stale state and fail closed. On non-Linux/WSL, a fail-closed
  `ps` fallback or explicit prerequisite refusal is used. `pg_terminate_backend`
  excludes the reset backend's own PID and prints the terminated PIDs/database.
- Crash test: SIGKILL the **reset wrapper/process group** (not only the
  backend) mid-seed; PID/port/lock/env/marker state remains. The next reset
  proves ownership, kills only that group, terminates demo-DB connections,
  clears the lock/env/markers and succeeds.
- Port test: `DEMO_API_URL` must be loopback and an owned/free port, or the
  reset allocates and prints it; a port already in use is refused before any
  delete.
- User-drift test: register `extra@t.com` after reset; verify fails because the
  manifest expects exactly the two seed users. Runtime/admin/security rows are
  classified out-of-fixture, not treated as fixture data.
- Manual drift test: mutate the card title, description, checklist, label,
  links, column/position, priority, assignee and cover; verify fails; reset;
  verify passes.
- Guard test: a non-demo database name is refused before any delete; a
  `DEMO_API_URL` that is not bound to the resolved demo database is refused
  before the first delete; conflicting `DATABASE_URL`/`API_URL` values are
  refused; a direct `SEED_ALLOW=1` invocation without the demo env pair is
  refused. Base pixel seed accepts only `janosik_pixel` / `*_pixel`; a direct
  base-seed run with `DATABASE_URL=.../janosik_task176_demo` is refused before
  any delete.
- Redaction test: reset logs contain host/database only, never a username,
  password, full connection string, PAT or token; the seed's raw token/password
  output is suppressed by default and only available via an explicit 0600 file.
- Verify read-only test: Prisma-only; no email/password login, no PAT, no
  `ApiToken.lastUsedAt` mutation, no refresh-token write.
- Comment-set test: the 60 `t176-comment-*` rows are absent from the TASK-176
  fixture or match a separately declared TASK-176.9 fixture; no silent ignore.
- Idempotency: reset twice, verify both times; stable IDs/titles are identical,
  timestamps may differ.
- Documentation test/check: the documented command matches the npm script and
  the database name matches the guard.
- Regression: the pixel parity fixture still seeds by default if the TASK-176
  overlay is optional; do not break the existing `seed-agent-pixel-demo.mjs`
  entry point.

### 183.2 — label timestamp

- Shared reducer unit: `SET_CARD_LABEL` add/remove advances `updatedAt` to
  `action.at`; no-op does not; inverse uses `cardUpdatedAt`. Assert only
  `updatedAt`/`labelIds` on the shared card state.
- Shared inverse unit: undo restores the exact previous timestamp; redo applies
  the new stamp.
- `validate.test.ts`: an inverse `SET_CARD_LABEL` with `cardUpdatedAt` is
  accepted unchanged after adding the type to `CARD_STAMPED_TYPES`; a
  non-inverse command still drops it.
- Backend writer unit: `bumpCard` is called with the stamped after-state; the
  database update receives the same `updatedAt` and a single version increment.
- Persistence/integration: send the forward command **and its inverse** through
  `POST /commands`, then read the card row. Assert the persisted `updatedAt`,
  `version = previous + 1`, `lastActorId = actor` and `labelIds`; do not assert
  those server-only fields on reducer state.
- UI `board-diff`: a label-only change with a new `updatedAt` is reported by
  the timestamp fast path; the old equal-timestamp compatibility case remains
  covered if the fallback is retained.
- UI card surfaces: “Updated”/table date changes after a label toggle; second
  tab/focus refetch reflects it.
- Audit regression: the §3.3 matrix, especially checklist/link cases, remains
  green. The 183.3 board-wide delete/restore tests are listed below.

No existing test is weakened. The `TASK-156` label-diff test is updated only
with an explicit compatibility rationale.

### 183.3 — board-wide label timestamps

- Shared reducer: a `DELETE_LABEL` that touches two cards stamps both
  `updatedAt` values with the command clock (and leaves an unaffected card
  untouched); `RESTORE_LABEL` writes each assignment's `updatedAt` back.
- Shared inverse: `invert(DELETE_LABEL)` carries the per-card previous
  timestamps, and undo restores the board byte for byte;
  `invert(RESTORE_LABEL)` carries inverse-only `DELETE_LABEL.cardStamps` so a
  redo/undo of the restore is exact too.
- `validate.test.ts`: a pre-183.3 `RESTORE_LABEL` assignment without
  `updatedAt` is accepted unchanged; a new assignment keeps the timestamp; an
  inverse `DELETE_LABEL` accepts `cardStamps`, while a fresh delete drops them.
- Backend writer unit: `DELETE_LABEL` calls the card bump for every live
  affected card; `RESTORE_LABEL` bumps each assignment with its saved stamp.
- Persistence/integration through `POST /commands`: every affected card has
  `updatedAt = command stamp`, `version = previous + 1` and
  `lastActorId = actor`; the inverse restores the exact prior `updatedAt` and
  adds one more version step; the old-shape inverse falls back to the undo
  clock; a stale `ifMatchVersions` card precondition answers `409` while the
  current one applies. No regression for the 183.2 single-card test.
- Audit regression: `RENAME_LABEL` and `SET_LABEL_COLOR` leave the card row
  (timestamp, version, actor) untouched.

---

## 6. Dependencies

- **TASK-176 demo setup** — this ticket captures and cleans the fixture that
  the TASK-176 manual investigation used. The exact ad-hoc setup command is not
  committed; the ticket replaces it with a reproducible one.
- **TASK-156** — the label-only `updatedAt` workaround in `board-diff` and its
  test. The fix should leave a documented compatibility note if the fallback is
  kept.
- **TASK-150** — the focus-diff fast path that trusts `updatedAt`; the label
  fix must keep its correctness and tests.
- **TASK-21.7d** — inverse timestamp semantics (`cardUpdatedAt`,
  `boardUpdatedAt`). The label inverse must follow the same contract and pass
  `shared/src/store/validate.ts` (`CARD_STAMPED_TYPES`).
- **Backend env precedence** — `backend/src/config/env.ts` loads `.env`,
  `.env.${NODE_ENV}` and `.env.local` with `override: true`; the reset needs a
  fail-closed env file passed via **CLI args/pre-dotenv snapshot** (unique 0600
  temp file, one-time nonce, `NODE_ENV !== "production"`, no `.env.local`
  fallback). This is the only backend-runtime change outside the label fix; no
  schema migration.
- **TASK-180.7** — demo/admin data lifecycle (H9). This ticket is about the
  developer demo fixture, not the admin demo runner. Coordinate only if a
  shared cleanup helper is introduced; do not absorb H9.
- **TASK-176.9** — explicitly separate. No card-editing UI, no admin card
  editor and no attribution work belongs here.
- **No new migration.** The label fix touches the reducer, `invert.ts`,
  `validate.ts`, the writer and tests; the demo fix touches scripts/docs/fixture
  files and a small fail-closed backend env-precedence hook for the reset. It
  uses the existing migrations; no schema migration is introduced.

---

## 7. Out of scope

- Production code or tests in this docs-only branch.
- Rewriting the admin demo runner, its manifest or its H9 cleanup semantics.
- A new destructive HTTP endpoint for demo cleanup.
- Targeted SQL cleanup of the current database instead of a deterministic
  reset.
- Changing the board command API, `Card.version` semantics, CAS or approval
  behaviour.
- Card editing, card relations, admin card UI or attribution (TASK-176.9).
- Label rename/color timestamp semantics.
- UI redesign, new navigation, new settings surfaces or any unrelated board
  work.
- Committing secrets, test tokens or a live database dump.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Reset wipes the wrong database. | Explicit `DEMO_DATABASE_URL`, exact-name guard, printed host/database only, `SEED_ALLOW`/`DEMO_RESET_ALLOW`, and a dry-run/verify mode. |
| `backend/.env` overrides the shell URL back to dev. | Require a reset env file passed via **CLI args/pre-dotenv snapshot** (unique 0600 temp file, one-time nonce, `NODE_ENV !== "production"`); remove the `.env.local` fallback; test with `backend/.env` pointing at dev and `DEMO_DATABASE_URL` at demo. |
| The API writer points at a different database than the reset. | Require `DEMO_API_URL` with no default; refuse conflicting env; prove identity with a Prisma-created marker user/board/accepted ADMIN membership + minted JWT or equivalent endpoint before deleting; `/health db: up` is not enough. |
| The post-seed backend is left running or a crash leaves open connections. | Process group + PID/port/lock per demo DB; kill stale reset-owned backend and `pg_terminate_backend` demo connections at reset start; fresh private port; stop before drop, stop after seed/before verify, stop/reap in `finally`; SIGKILL-crash regression. |
| The current delete sequence fails on FK `RESTRICT`. | Drop/recreate the demo schema and apply migrations; if using ordered deletes, cover `ChecklistItem`, `Checklist`, `CardLink`, `CardLabel`, shares/audit, security/admin/idempotency/reminder tables, and announcement-dismissal cascade; add a reset-twice test with non-zero rows before each run. |
| Fallback scope contradicts the primary reset. | Chosen: **fixture + admin/security account reset**; global settings/announcements retained. Keep `SecurityAuditLog`/`Admin*`; retain flags/mail/templates/ops/throttle/announcements; `AnnouncementDismissal` cascades with deleted users. Do not call it a full demo-DB reset. |
| Retained `EmailSettings` becomes undecryptable. | Reuse the original `SETTINGS_SECRET` (or original `JWT_SECRET` when empty) in the reset env; otherwise document/force SMTP credential re-entry. Test decryptability or re-entry. |
| The intended `TASK-176 acceptance` label/checklist/links are lost by a reset. | Decide their status before resetting; commit them to the manifest if canonical. Do not run the destructive reset until that decision is recorded. |
| Extra app users (`1@t.com`, `2@t.com`) silently become canonical. | Manifest expects exactly the two seed users and their board roles; an extra registration after reset fails verify. |
| The `t176-comment-*` set is accidentally treated as TASK-176 canonical. | Classify it as TASK-176.9 scaffolding, remove it from the TASK-176 fixture, or declare a separate fixture; verifier checks the decision. |
| The seed is partial after an API/runtime failure. | Run the verifier after the seed; fail loudly; document “rerun reset” rather than hand-patching. |
| The seed changes the existing pixel parity fixture. | Keep the base seed output stable; make TASK-176 an explicit overlay or parameter, and test both modes. |
| Seed/reset logs leak tokens or passwords. | Capture and redact output by default; raw secrets only via an explicit 0600 file; secret values never in stdout, URLs or CI logs. |
| Admin DB URL in argv leaks into `ps`/history. | Only document `demo:task176:admin`, pass URL via 0600 env/child env; reject credential-bearing `--database-url`; test argv/`ps`/stdout/logs. |
| Retained `EmailSettings` becomes undecryptable. | Reuse the original `SETTINGS_SECRET` (or original `JWT_SECRET` when empty) in the reset env; otherwise document/force SMTP credential re-entry. Test decryptability or re-entry. |
| Verify mutates a session or `ApiToken.lastUsedAt`. | Prisma-only verification; no login/PAT. If an API read is ever added, ignore `lastUsedAt` and re-mint a known token. |
| Primary/fallback removes the master account. | Recreate with `npm run demo:task176:admin -- --email <master>` (only documented path; URL via 0600 env/child env, not argv; first master OWNER) against the demo DB after either path. |
| The label fix breaks undo timestamps. | Add `cardUpdatedAt` to the inverse, add `SET_CARD_LABEL` to `CARD_STAMPED_TYPES`, and assert exact restore through `POST /commands`. |
| `DELETE_LABEL`/`RESTORE_LABEL` expand the change beyond a small fix. | Decide explicitly: forward stamping plus per-card assignment timestamps and validation, or a named follow-up with a regression test. |
| The `board-diff` fast path becomes incorrect or overly broad. | Update the comment/test; keep the `labelIds` fallback as a compatibility guard until all writers are verified. |
| “Updated” changes cause extra refetches or noisy UI. | Expected and correct; scope is one timestamp field, not polling or cache redesign. |
| Clock/timezone assertions are flaky. | Use the command `at` / `cardUpdatedAt` values, never wall-clock comparisons. |

---

## 9. Open questions

1. **Are the `TASK-176 acceptance` checklist, `TASK-176 demo` label and named
   `px-link-task176-*` links canonical?** They are present in the database but
   absent from every committed seed. If they are part of the intended manual
   acceptance fixture, commit them; if not, remove them. Do not reset the
   current database before this is answered.
2. **Are the assignee, cover, priority and move-to-Done changes canonical?** The
   fixture card currently has `assigneeId=px-user-admin`, yellow cover,
   `priority=blocker` and sits in `px-col-ops-done` at index 2. They are not in
   the seed. Decide yes/no for each; the manifest must pin either the observed
   value or the seed default.
3. **Are the 60 `t176-comment-*` rows part of TASK-176 or TASK-176.9?** The text
   says “TASK-176.9 demo comment”; 9 rows are soft-deleted and 51 live.
   Recommended: keep them out of the TASK-176 fixture; if pagination testing
   needs them, declare a separate TASK-176.9 fixture.
4. **One shared reset database or a template clone per session?** Recommended:
   one reset database plus `verify` for the first version; document template
   cloning for teams that need parallel manual sessions.
5. **Should `DELETE_LABEL` and `RESTORE_LABEL` be fixed in 183.2?** No — the
   multi-card change shipped separately as TASK-183.3. See §3.3 for the
   implementation note, regression coverage and the per-card undo contract.
6. **Should label rename/color bump affected cards?** No. Label metadata
   changes, not card membership; the card content is unchanged. The decision is
   recorded in the audit table and pinned by an e2e regression.
7. **Where should the demo docs live?** Recommended: `docs/DEMO-FIXTURES.md`
   with a short link from the pixel parity README and the TASK-176 task doc.
8. **Should `verify` run in CI?** It needs a seeded database; the seed's
   command transport needs a backend. Recommended: run it locally before manual
   acceptance; add a CI job only if a disposable Postgres service is already
   part of the pipeline.
9. **How should the reset prove the API uses the demo database?** Create the
   marker user/board/accepted ADMIN `BoardMember` directly through the reset
   Prisma connection against the validated demo DB; mint
   `{ sub, aud: "janosik-user", stamp, exp }` with the reset-env `JWT_SECRET`,
   computing `stamp` via a parameterized `securityStamp(user, secret)` or the
   same HMAC (not the env-bound dev helper); call only `GET /boards/:marker`.
   Correct DB → 200; any non-200 aborts before delete. Clean markers before the
   drop and in `finally`, use a fresh connection after reset, and sweep stale
   markers at start.
10. **How should the reset force `DATABASE_URL` past `dotenv override: true`?**
    Required: snapshot `process.env` before dotenv, pass reset mode/path/nonce
    **only as CLI args** (`--demo-reset`, `--demo-reset-env-file`,
    `--demo-reset-nonce`), and use the pre-dotenv `NODE_ENV` for the production
    gate. The env file is unique/0600/one-time nonce; no `.env.local` fallback;
    missing/mismatched file aborts; normal boot ignores the hook. `.env` values
    cannot disable/redirect it.
11. **Should the reset apply migrations?** Yes, as part of drop/recreate
    (`prisma migrate reset --force --skip-seed` on the guarded demo DB). Existing
    migrations only; no new migration is introduced by this ticket. The manual
    seed path still documents `prisma migrate deploy`.
12. **Are `1@t.com`/`2@t.com` junk and are admin/security rows out-of-fixture?**
    Recommended: yes — expect exactly the two seed users; extra users fail
    verify. Runtime/admin/security rows are out-of-fixture; after either reset
    path recreate the master with `npm run demo:task176:admin -- --email
    <master>` (the only documented path). The wrapper passes
    `DEMO_DATABASE_URL` via a 0600 env file or child env, never argv. If
    `--database-url` remains, reject credential-bearing argv and require the URL
    from `DEMO_DATABASE_URL`; parse args/construct Prisma after dotenv.
13. **Fallback scope — chosen: fixture + admin/security account reset.**
    Keep `SecurityAuditLog`, `AdminAuditLog`, `AdminRefreshToken` and `AdminUser`
    in the fallback; retain `FeatureFlag`, `EmailSettings`, `EmailTemplate`,
    `OpsSettings`, `ThrottleSettings`, `Announcement` and
    `AnnouncementTranslation`. `AnnouncementDismissal` is not explicitly deleted;
    rows for deleted users cascade. Retained `EmailSettings` requires the same
    `SETTINGS_SECRET`/original `JWT_SECRET` or SMTP credential re-entry. This is
    **not** a full demo-DB reset and is not claimed to match
    `prisma migrate reset`; master recreation is required after the
    admin/security portion.

---

## 10. Definition of done

- The TASK-176 demo fixture is committed as stable data or a seed overlay.
- `npm run demo:task176:reset` recreates it on a correctly named disposable
  database after documented prerequisites, using one resolved DB URL forced
  past `dotenv override: true` via CLI/pre-dotenv reset env, a verified
  `DEMO_API_URL`, a real Prisma-created marker probe, and a drop/recreate or
  narrowed fallback.
- The identity marker is created directly through the reset Prisma connection
  (user + board + accepted ADMIN `BoardMember`), the JWT is minted with
  `aud: "janosik-user"` and a stamp from the **parameterized** `securityStamp`
  using the reset secret, and only `GET /boards/:marker` goes through the API.
  Correct DB → 200; any non-200 (401/403/404) aborts before any delete. Markers
  are cleaned before the drop and in `finally`, with a fresh connection/state
  after reset and a stale sweep at start.
- The reset owns the backend process group on a fresh private port with
  PID/start-time/port/lock/nonce, verifies ownership before killing a stale
  process, terminates demo-DB connections before the drop, restarts for seed
  only, stops before the Prisma-only verify and reaps in `finally`; a
  live-non-reset-process test and SIGKILL-wrapper rerun pass.
- Reset succeeds twice after adding a checklist and a card link, with non-zero
  `SecurityAuditLog`, `IdempotencyRecord`, `ReminderSent`, `AdminUser`,
  `AdminRefreshToken` and `AdminAuditLog` rows before **each** run, plus a
  dismissal that cascades with the deleted user; no FK `RESTRICT` failure and no
  open-connection failure.
- The manifest expects exactly the two seed app users and their board roles;
  registering an extra user fails verify. Runtime/admin/security rows are
  out-of-fixture. The fallback is a **fixture + admin/security account reset**;
  global flags/mail/templates/ops/throttle/announcements are retained, and
  `AnnouncementDismissal` cascades with deleted users. Both primary and fallback
  require `npm run demo:task176:admin -- --email <master>` (the only documented
  path; URL via 0600 env/child env, not argv) against the demo DB. Retained
  `EmailSettings` uses the same `SETTINGS_SECRET`/original `JWT_SECRET`, or the
  docs require SMTP credential re-entry.
- `npm run demo:task176:verify` passes after reset, is Prisma-only/read-only,
  and fails on the observed artifacts (`Card claim visibility 123`, `фывфыв`,
  checklist `123`, random-UUID link) and on any undecided
  assignee/cover/priority/move value.
- Reset/seed output is redacted; no raw PAT, password or connection string is
  printed, and raw secrets are only available via an explicit 0600 file if
  parity tooling needs them.
- Manual edits are detected and reset; the canonical fixture is not silently
  polluted. The 60 `t176-comment-*` rows are absent or declared as a separate
  TASK-176.9 fixture.
- `SET_CARD_LABEL` advances `updatedAt` and `version` consistently in the
  reducer, the persisted row and undo/redo; `SET_CARD_LABEL` is in
  `CARD_STAMPED_TYPES` and the inverse survives `POST /commands`.
- The same-class audit is complete: `DELETE_LABEL`/`RESTORE_LABEL` are fixed
  with forward stamping and per-card inverse timestamps, or explicitly deferred
  with tests and a named follow-up; label metadata actions are documented as
  intentional.
- The reset env hook requires a unique 0600 env file passed via CLI args or a
  pre-dotenv snapshot with a one-time nonce, is disabled in production
  (production + reset mode is refused), has no `.env.local` fallback, aborts on
  a missing/mismatched file and sweeps stale reset files at start; normal boot
  ignores it.
- `securityStamp(user)` keeps its one-argument auth behavior; the reset uses
  `securityStamp(user, secret)`/the same HMAC with the reset secret. Both paths
  are tested.
- Tests cover reducer state (`updatedAt`/`labelIds`), persisted server fields
  (`updatedAt`/`version`/`lastActorId`/`labelIds`), validation, inverse through
  `POST /commands`, reset-twice, SIGKILL recovery, production/stale-file
  startup, verifier failures and the UI fast path.
- No existing expectation is weakened; docs and `CHANGELOG.md` describe the
  fixture workflow, the schema-reset requirement and the timestamp fix.
- No new migration is added: the demo reset uses the existing migrations, and
  the label fix is reducer/invert/validate/writer/tests only.
- The ticket does not touch TASK-176.9, the admin demo runner or the board
  command contract beyond the label timestamp consistency.
