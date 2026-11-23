# TASK-200.11 — Command log: monthly partitions and a detail side table

Status: implemented. Base: `main` @ `35cfdfeb`. This is the design and
operations note for the command-log storage change; the runtime contract
(replay, `seq`, idempotency, undo) is unchanged.

## 1. Why monthly partitions (not per-board)

`Command` is the board's replay log, but retention is **time-based**:
`OpsSettings.retentionDays` (default 30) is the same knob that purges
soft-deleted rows. A monthly `RANGE (createdAt)` scheme gives:

- **Retention is `DROP TABLE`.** A finished month is removed with metadata
  work instead of deleting tens of millions of rows and leaving a bloated heap
  for autovacuum. Default partitions and the unpartitioned registry still need
  bounded row deletes.
- **Pruning matches every hot read.** A board feed/delta always carries
  `boardId` plus a time or `seq` bound; with 30-day retention only the current
  and previous monthly partitions are live, so `id`/`seq` probes touch two or
  three children instead of the whole history.
- **The partition count stays bounded.** One partition per month (plus a
  default) is a dozen objects; per-board partitioning would create thousands
  of partitions, make cross-board admin queries fan out, and still could not
  drop a retention window without row deletes.

`Command`, its detail side table `CommandDetail`, `CommandPreimage` and the
unpartitioned `CommandKey` registry share the retention window. A whole-month
drop locks in reader order (Command → CommandDetail → pre-images), drops the
command, detail and pre-image partitions, and leaves the registry keys for the
bounded orphan sweep (the unpartitioned registry is too large for an inline
month delete). Default partitions and registry keys are the rows left for
chunked deletes.

## 2. Schema and constraints

| Table | Key | Partition key | Notes |
| --- | --- | --- | --- |
| `Command` | `(id, createdAt)` | monthly `createdAt` | The old `id` PK is impossible on a partitioned table: PostgreSQL requires every unique constraint to contain the partition key. |
| `CommandKey` | `id` | none (global) | Unpartitioned registry that restores the old `Command_pkey` guarantee across boards and months; `boardId` scopes id-only reads/purges and `createdAt` drives the bounded orphan sweep. |
| `CommandDetail` | `(commandId, createdAt)` | monthly `createdAt` | Heavy display snapshot; boardId column, no FK (moved with its command). |
| `CommandPreimage` | `(commandId, createdAt)` | monthly `createdAt` | Run undo snapshots; same shape as before, now partitionable by time. |

### Detail lifecycle and key moves

A partitioned→partitioned foreign key is expanded into per-partition
constraints. PostgreSQL then refuses `DROP TABLE Command_YYYYMM` with
`constraint CommandDetail_... depends on table Command_YYYYMM`, and the only
way out is dropping the parent FK and revalidating it over the whole detail
table. That is incompatible with monthly retention.

Instead:

- `CommandKey` is unpartitioned with `id` as its primary key; a BEFORE INSERT
  trigger on `Command` claims the id. The trigger upserts for the same board
  (so a row move is not a duplicate) and raises 23505 for a cross-board id;
  the old global idempotency guarantee therefore survives the composite
  `Command` key and a concurrent collision answers `409 id_conflict`. The DB
  guarantee here is cross-board uniqueness; a same-board duplicate of a live
  id is rejected by the application pre-check inside the board lock, not by
  the upsert (a raw same-board INSERT is not blocked).
- `CommandDetail` has **no FK** to `Command`/`CommandKey`. It stores `boardId`
  for scoping, and a deferred `Command` delete trigger removes the detail only
  when no replacement row exists. The move trigger rewrites both
  `CommandKey.createdAt` and `CommandDetail.createdAt`, so a backdated demo
  command keeps its key and display snapshot in the new month.
- the deferred delete trigger never deletes `CommandKey`; the maintenance
  sweep removes only keys with `NOT EXISTS (Command id+board)` in bounded
  chunks. That keeps the large unpartitioned registry out of the DDL path and
  cannot delete a live key whose command moved to a newer `createdAt`.
- every id-only purge/sweep page is additionally paired with `boardId` (or
  accepts that the key is global). Account deletion resolves actor command ids
  in bounded pages before deleting them and removes `CommandKey`/`CommandDetail`;
  board purge and demo purge delete their board/actor-scoped keys/details from
  the same command pages, so erasure does not wait for retention and never
  issues an unbounded detail/key DELETE inside the board transaction. The
  registry has a `boardId` index for the defensive orphan passes.
- a **registry tombstone** is client-visible: deleting a command keeps its
  `CommandKey` until the bounded orphan sweep, so reusing that id on another
  board before then answers `409 id_conflict`. Reusing it on the same board
  upserts the key. This is deliberate global-id retention, not an orphan leak;
  account/board/demo erasure removes the keys immediately.

- Demo purge keeps a bounded board-orphan `NOT EXISTS Command` pass for
  legacy demo rows whose command was already gone; real commands on a shared
  configured board keep their keys/details.

The fixed-id command suites (`events`, `commands-undo`, `admin-throttle-demo`,
the partition/global-id specs) use `wipeAll`, which includes `Command`,
`CommandDetail` and `CommandKey`. Other suites keep their custom wipes; those
must delete the same three tables or use `wipeAll` before a fixed-id retry.

The migration keeps the ordinary `Command → Board/User` FKs (a partitioned
child referencing an unpartitioned parent is supported and does not block
month drops).

### Indexes

Every parent index is inherited by each partition:

- `Command`: PK `(id, createdAt)`, `(boardId, seq)`,
  `(boardId, createdAt, seq)`, `(createdAt)`, `(actorId, createdAt)`,
  `(type, createdAt)`, `(apiTokenId, createdAt)`,
  `(agentSessionId, createdAt)`, `(runId)`, GIN `(touches)`.
- `CommandKey`: PK `(id)`, `(boardId)`, `(createdAt)`.
- `CommandDetail`: PK `(commandId, createdAt)`, `(boardId, commandId)`.
  No `(createdAt)` index: months are dropped by name and reads batch by
  board + commandId.
- `CommandPreimage`: PK `(commandId, createdAt)`, `(boardId, runId)`,
  `(createdAt)`.

## 3. Size plan (30 days does not become unbounded)

The storage levers, in order of impact:

1. **Month drop.** A finished month is dropped instead of deleted row by row
   and leaves no dead heap. This is not "bounded by construction": the target
   holds only while the hourly sweep drains the incoming rows faster than the
   target load. The command log uses its own budget — 1,000 rows × 1,000
   chunks per table per run (1M commands/hour, 24M/day) — which exceeds 50
   commands/s (4.32M/day) with headroom. If the scheduler is paused or the
   budget is reduced, the effective window grows beyond 30 days; monitor
   partition age and size, not just the config value.
2. **Detail size caps.** `commandDetails` clips every snapshot string to
   1 024 characters (head + tail, or a window around the first difference for
   long description/task-spec/card-order pairs) and enforces a 16 KiB
   serialized ceiling. A 64 000-character description edit used to freeze two
   64k walls per keystroke; it now stores at most ~1 KiB per side. The cap is
   on the **detail snapshot**, not on the action payload: `UPDATE_CARD` still
   carries the full description it needs for deterministic replay. 16 KiB is
   a worst-case bound, not an inline target — JSONB above roughly 2 KiB is
   TOAST-compressed.
3. **Side table.** Heavy diffs no longer sit in the hot command row; the
   command heap keeps the replay payload/result, which are required for
   resync and audit. Both are JSONB and TOAST-compressed when large.
4. **Pre-images are only for runs** (PAT batch/plan/destructive apply); ordinary
   human/browser commands do not write one. The writer now stamps the
   pre-image with the command's clock, so the pair retires in the same month.
5. **Retention knob.** `OpsSettings.retentionDays` / `PURGE_AFTER_DAYS`
   controls the whole window; lowering it changes the monthly drop point.
   Legacy pre-migration detail rows are copied as-is (they may exceed the new
   cap); the application cap applies to every snapshot written after the
   upgrade.
6. **Registry cost.** `CommandKey` is one unpartitioned row per retained
   command (id + board + createdAt + index, roughly 70–120 B before bloat) and
   is drained in bounded `NOT EXISTS Command` batches, not by month DDL.
   Include it in disk and WAL planning: at 50 commands/s × 30 days that is
   another ~130M rows (order 10–15 GB plus the PK, `createdAt` and `boardId`
   indexes) and deleting it creates dead tuples plus WAL that autovacuum must
   reclaim. Partition drop is cheap for Command/Detail/Preimage; the registry
   is the one retention cost that is proportional to row count.

Planning numbers (order-of-magnitude, not a benchmark claim). Partition
granularity is monthly and the sweep runs hourly, so the **effective live
window is 30–60 days** (the current and previous calendar month); budget for
up to ~2× the nominal 30-day rows:

| Load | Commands / 30d | Commands / 30–60d | Storage at ~0.5–1 KB/row | Storage at ~2 KB/row |
| --- | --- | --- | --- | --- |
| 25 cmds/s | ~65M | ~130M | ~65–130 GB | ~260 GB |
| 50 cmds/s | ~130M | ~260M | ~130–260 GB | ~520 GB |

Add the unpartitioned registry on top: ~130M rows at 50/s × 30 days, roughly
10–15 GB of heap+index; the 30–60-day live window can double that (~20–30 GB),
plus dead tuples/WAL from the orphan sweep. WAL is not included in these
figures; a large backfill, index build or delete series needs free WAL space
and autovacuum headroom.

The target is **not** “always under 100 GB”; it is that growth is a function
of the chosen window, not of history, and that the operator can see the
footprint before it becomes an incident. The admin observability payload
exposes per-partition estimated rows, bytes, dead tuples and vacuum times
(see §5). If the measured average is above the plan, shorten
`retentionDays`, archive/dump a month before it expires, or reduce the
detail/pre-image volume; do not let the default partition accumulate.

## 4. Agent retention decision

Agent and human commands share `retentionDays`. A shorter agent-only window
would remove command rows and pre-images while `AgentRun` rows are still
rollback-eligible, turning a valid run into `run_expired` and losing audit
evidence. The DB audit trail (`AdminAuditLog`) does not contain ordinary
agent commands, so it cannot substitute. Operators who accept that trade-off
lower the global window; the maintenance job deliberately has no separate
agent cutoff.

## 5. Maintenance and metrics

Three maintenance jobs (all idempotent, part of the existing scheduler and
`POST /admin/maintenance/run`; `ensure-command-key-index` runs first in the
`all` order so purge/demo board scans have the registry index):

- `ensure-command-key-index` — builds the deferred `CommandKey(boardId)` index
  with `CREATE INDEX CONCURRENTLY` when migration 6 skipped it.

- `ensure-command-partitions` — ensures previous, current and the next three
  UTC months (never a month already fully outside the retention window). If a
  requested month has rows in a default partition, the SQL helper returns
  `skipped:<default>=<n>;…` and the job logs/reports the skip instead of
  failing with 23514. A `run("all")` isolates each job: a failed sweep is
  reported in the result and later jobs still run.
- `sweep-commands` — drops whole expired months via
  `janosik_drop_command_partition(date)` (Command → detail → pre-images), then
  chunk-deletes the partial current/default months (pre-images first) and
  drains `CommandKey` with a bounded `NOT EXISTS (Command id+board)` query.
  Whole-month DDL retries a 2 s reader lock up to three times, then leaves the
  month for the next hourly run. Agent runs are swept afterwards by the
  existing `sweep-runs`.

The board purge takes the board advisory lock and pages its subtrees; the
month drop takes partition locks in reader order. They do not share a lock
order, so a concurrent drop can meet the board transaction: the drop has a 2 s
`lock_timeout` and returns `-1`, and the sweep leaves that month for the next
hourly run instead of failing. A purge/erase never waits on the DDL.

`GET /api/v1/admin/observability` includes `commandLog` (the current admin
Observability page does not render this block yet; it is an API/CLI metric):

```json
{
  "available": true,
  "retentionDays": 30,
  "partitions": [
    {
      "parent": "Command",
      "name": "Command_202611",
      "rows": 1234,
      "sizeBytes": 9000000,
      "deadRows": 42,
      "lastVacuumAt": 1732233600000,
      "lastAutovacuumAt": null
    }
  ],
  "defaultRows": 0,
  "registry": {
    "rows": 1234,
    "sizeBytes": 160000,
    "deadRows": 12,
    "lastVacuumAt": 1732233600000,
    "lastAutovacuumAt": 1732233600000
  }
}
```

`partitions[].rows` comes from `pg_class.reltuples` (planner estimate) so
opening the panel does not run `count(*)` over a hundred million rows.
`registry` is the same estimate/size/dead-tuple view for the unpartitioned
`CommandKey` table (including its indexes); it is the retention cost that does
not shrink with `DROP TABLE`, so watch its dead tuples after sweeps.
`defaultRows` is the opposite: an exact count over the three default
partitions. It should stay at zero; a growing default partition means an
`ensure` run was skipped or a restored row fell outside the pre-created
months, and the next `ensure` will report `skipped:` until it is moved.

## 6. Migration

Seven migrations:

1. `20261123130000_task_200_11_command_log_partitioning` — partition swap.
2. `20261123131000_task_200_11_command_details_side_table` — details backfill
   and column drop.
3. `20261123132000_task_200_11_command_key_registry` — global `CommandKey`,
   triggers, detail FK.
4. `20261123133000_task_200_11_safe_partition_drop` — default-partition skip
   and lock-ordered/retrying drop helper.
5. `20261123134000_task_200_11_command_key_move` — board-scoped detail column,
   no detail cascade, upsert/deferred move lifecycle, keys swept separately.
6. `20261123135000_task_200_11_command_key_board_index` — `CommandKey(boardId)`
   for purge scans; inline only for a registry under 1M rows **and** 64 MiB,
   otherwise deferred to
   `ensure-command-key-index` (`CREATE INDEX CONCURRENTLY`).
7. `20261123136000_task_200_11_command_preimage_move` — move pre-images with a
   command's `createdAt` (seed/backdate), keeping the run pair in one month.

**Pre-checks**

- Take a `pg_dump` (rollback is a backup restore; there is no down
  migration).
- Free space: peak is roughly **2× the current command-log size** (old +
  new table while copying), plus the `CommandKey` index/WAL footprint for
  migration 6. The concurrent build needs at least the final index size free
  while it runs.
- Stop writes/old API replicas for the **whole migration**, not just the swap.
  Migration 1 renames the old tables and then copies/builds indexes inside one
  transaction; the old names carry an ACCESS EXCLUSIVE lock until that
  transaction commits. A writer pointed at the old name during any of those
  steps blocks or fails. On a single Docker host `prisma migrate deploy` runs
  before the new API starts; on a multi-replica rollout stop all old replicas
  first and expect downtime proportional to the copy. `lock_timeout` is 30 s,
  so a competing lock fails the migration rather than hanging the boot
  indefinitely.
- **Pre-release checksum:** an earlier pre-release (`5f21ac57`) applied the
  original migration 1, and this branch corrected it in place. A database that
  applied that checksum must be recreated or its `_prisma_migrations` row
  resolved/updated from a backup before deploying; the old max-only `setval`
  may already have lowered the sequence. Restore the backup (preferred) or
  repair `Command_seq_seq` with the high-water rule above and verify the next
  `seq` is above every surviving/deleted high-water mark. Fresh installs and
  databases that have not run the old checksum need no action.

**Steps**

Migration 1 (`...partitioning`, one transaction):

1. Create the DDL helpers.
2. Rename the old tables to `*_legacy_task20011` and free the canonical
   constraint/index names.
3. Create partitioned `Command` (still with `details`) and `CommandPreimage`;
   create a monthly partition for every month present in the old data plus the
   current window, then the default partitions.
4. Copy the rows and verify exact command/preimage counts; any mismatch raises
   and the whole transaction rolls back.
5. Build PKs/FKs/indexes, transfer sequence ownership (the old table must not
   take `Command_seq_seq` with it), then read `last_value`/`is_called` and
   `setval` to `GREATEST(max(seq), last_value, 1)` with `is_called=true`
   whenever `Command` is non-empty. The sequence must never move backwards or
   reuse a deleted `seq`; deleting the newest command before this migration is
   covered by the migration check.
6. Drop the legacy tables after verification.

Migration 2 (`...details_side_table`, one transaction):

1. Extend the ensure/drop helpers to `CommandDetail`.
2. Create the detail parent, one partition per command month, and its default.
3. Copy `Command.details → CommandDetail.data`, verify the non-null count.
   Legacy blobs are copied as-is; the new application cap starts with the
   next written snapshot.
4. `ALTER TABLE Command DROP COLUMN details` (metadata-only on a partitioned
   table) and build the detail PK/index.

Migration 3 (`...command_key_registry`, one transaction):

1. Create and backfill `CommandKey`; fail loudly if the old data has duplicate
   ids.
2. Delete unreachable orphan details, add the FK to `CommandKey`, drop the
   unused detail `createdAt` index.
3. Add BEFORE INSERT claim, AFTER UPDATE createdAt move and AFTER DELETE
   release triggers; `ANALYZE` all four tables.

Migration 4 (`...safe_partition_drop`, one transaction):

1. Recreate `janosik_ensure_command_partition` with the default-partition skip
   (`skipped:<table>=<rows>`). The expired-month filter lives in
   `MaintenanceService.ensureCommandPartitions` (TS), not in the SQL helper.
2. Recreate `janosik_drop_command_partition` with the reader lock order, 2 s
   lock timeout and `-1` retry signal.

Migration 5 (`...command_key_move`, one transaction):

1. Add `CommandDetail.boardId` (backfilled from `CommandKey`), drop the detail
   FK/index to the registry and add `(boardId, commandId)`.
2. Upsert the key on insert with a same-board guard; move key and detail on
   `Command.createdAt` changes; deferred detail cleanup on delete.
3. Stop the drop helper from deleting registry keys inline; the maintenance
   sweep drains `NOT EXISTS Command` keys in bounded chunks.

Migration 6 (`...command_key_board_index`):

1. `SET LOCAL lock_timeout = '5s'` and inspect `CommandKey` reltuples.
2. Below 1M rows and under 64 MiB (physical size or `relpages`), build
   `CommandKey_boardId_idx` inline (CI/fresh install).
   At 1M+ rows, skip the blocking build and log a notice.
3. Operators run `POST /admin/maintenance/run {"job":"ensure-command-key-index"}`
   in a quiet window; it builds `CREATE INDEX CONCURRENTLY` (out of
   transaction), retries an invalid leftover, and does not block writes.
   Reserve index + WAL free space and expect I/O during the build. A plain
   inline build on a 100–130M registry is never attempted at boot.

Migration 7 (`...command_preimage_move`):

1. Recreate the key claim/move triggers so a `Command.createdAt` rewrite also
   moves `CommandPreimage.createdAt`/`boardId` with the command and detail.
2. `ANALYZE CommandPreimage`; no index or table rewrite.

**Empty DB:** the same steps create empty parents/partitions and drop empty
legacy tables. **Existing DB:** the automated check
(`npm run test:migration:command-log -w backend`) builds both cases on
throwaway databases: it stops before the TASK-200.11 migrations, seeds three
months of commands/details/pre-images, then applies all seven and asserts
counts, routing, sequence, key uniqueness, detail move/no cascade,
`CommandKey_boardId_idx`, the skipped default month, pruning and retention.

**Rollout note:** after the swap, the first `ensure-command-partitions` run
is a no-op for the pre-created months; the scheduler extends the window.
Monitoring should show `defaultRows` near zero and the oldest partition
inside the retention window.

### Runbook: repairing a wedged default month

`ensure` reports `skipped:Command_default=…;CommandDetail_default=…;…` and
creates nothing for that month. Repair it in a quiet window (stop writes and
the scheduler), with the month's `YYYY-MM` fixed:

```sql
BEGIN;
-- 1. Copy the default rows out, one parent at a time.
CREATE TEMP TABLE cmd_default AS
  SELECT * FROM "Command_default" WHERE "createdAt" >= 'YYYY-MM-01'
    AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');
CREATE TEMP TABLE det_default AS
  SELECT * FROM "CommandDetail_default" WHERE "createdAt" >= 'YYYY-MM-01'
    AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');
CREATE TEMP TABLE pre_default AS
  SELECT * FROM "CommandPreimage_default" WHERE "createdAt" >= 'YYYY-MM-01'
    AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');

-- 2. Detach the three default partitions.
ALTER TABLE "Command" DETACH PARTITION "Command_default";
ALTER TABLE "CommandDetail" DETACH PARTITION "CommandDetail_default";
ALTER TABLE "CommandPreimage" DETACH PARTITION "CommandPreimage_default";

-- 3. Remove the originals from the detached tables (temp copies hold them).
DELETE FROM "Command_default" WHERE "createdAt" >= 'YYYY-MM-01'
  AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');
DELETE FROM "CommandDetail_default" WHERE "createdAt" >= 'YYYY-MM-01'
  AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');
DELETE FROM "CommandPreimage_default" WHERE "createdAt" >= 'YYYY-MM-01'
  AND "createdAt" < ('YYYY-MM-01'::date + interval '1 month');

-- 4. Create the month, then reattach the (now empty) defaults.
SELECT janosik_ensure_command_partition('YYYY-MM-01');
ALTER TABLE "Command" ATTACH PARTITION "Command_default" DEFAULT;
ALTER TABLE "CommandDetail" ATTACH PARTITION "CommandDetail_default" DEFAULT;
ALTER TABLE "CommandPreimage" ATTACH PARTITION "CommandPreimage_default" DEFAULT;

-- 5. Reinsert through the parent so routing, triggers and keys behave.
INSERT INTO "Command" SELECT * FROM cmd_default;
INSERT INTO "CommandDetail" SELECT * FROM det_default;
INSERT INTO "CommandPreimage" SELECT * FROM pre_default;
COMMIT;
ANALYZE "Command"; ANALYZE "CommandDetail"; ANALYZE "CommandPreimage";
```

The detail/preimage defaults have no keys of their own; the Command insert
upserts the existing registry row. Verify `defaultRows = 0` and that
`ensure-command-partitions` no longer reports a skip. If a `Command` row with
the same id already exists outside the default (manual repair), delete the
default copy instead of reinserting it — the registry is global.

### Runbook: intermediate duplicate ids

`CommandKey` has a primary key on `id`, so the registry itself cannot hold two
rows for the same id. The duplicate state exists only in the earlier
partitioned `Command` table (composite PK), before migration 3 backfills the
registry. Inspect and resolve it before re-running `prisma migrate deploy`:

```sql
SELECT id, array_agg("boardId") AS boards, array_agg("createdAt") AS times
  FROM "Command"
 GROUP BY id HAVING count(*) > 1;
```

Pick the canonical board/row (usually the first committed seq), export the
losing commands/details for audit, then delete them through the parent
(partitioned `Command` delete). There is no losing `CommandKey` yet. Re-run the
migration. The migration deliberately refuses to guess: a silent merge could
drop another board's history.

### Runbook: defensive key backfill

If a restore or manual command insert bypassed the `Command` trigger, reconcile
missing registry rows before trusting idempotency. Check for duplicate ids
first (cross-board duplicates cannot be reconciled automatically); then:

```sql
-- one row per command that has no key for its own board
INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
SELECT c."id", c."boardId", c."createdAt"
  FROM "Command" c
  LEFT JOIN "CommandKey" k
    ON k."id" = c."id" AND k."boardId" = c."boardId"
 WHERE k."id" IS NULL
ON CONFLICT ("id") DO NOTHING;

-- must be 0; any remainder is a cross-board id conflict needing manual triage
SELECT count(*) FROM "Command" c
 LEFT JOIN "CommandKey" k
   ON k."id" = c."id" AND k."boardId" = c."boardId"
 WHERE k."id" IS NULL;

-- key exists but points at a different board: never upsert over it silently
SELECT c."id", c."boardId" AS command_board, k."boardId" AS key_board
  FROM "Command" c
  JOIN "CommandKey" k ON k."id" = c."id"
 WHERE k."boardId" <> c."boardId";
```

### Runbook: orphan detail rows

The deferred Command delete trigger removes detail rows on a real delete. If a
manual SQL delete skips triggers, drain them in bounded batches:

```sql
WITH victims AS (
  SELECT d.tableoid, d.ctid
    FROM "CommandDetail" d
   WHERE NOT EXISTS (
     SELECT 1 FROM "Command" c
      WHERE c."id" = d."commandId" AND c."boardId" = d."boardId"
   )
   LIMIT 5000
)
DELETE FROM "CommandDetail" d
 USING victims v
 WHERE d.tableoid = v.tableoid AND d.ctid = v.ctid;
```

`ctid` is only unique inside one physical partition/table; always pair it with
`tableoid` (or delete by `(commandId, createdAt)`). A ctid-only predicate can
delete a live row in another monthly partition that reuses the same item
pointer. Repeat until 0 and mirror the query for `CommandKey` when needed.
Neither table has a `Command` FK, so this is the manual repair path.


## 7. Compatibility with the other TASK-200 work

- **Replay/resync (200.2/200.13):** `deltaSince` still returns `detail`; it
  now loads the detail side table in one board-scoped batch per page. The
  `seq` baseline and `resync` contract are unchanged.
- **Undo (166/180):** pre-images keep their exact JSON shape and use the
  command's clock; run analysis reads by `(boardId, runId)` and command ids.
  Rolling a run back still steps the pre-images in reverse order.
- **Admin (176/181):** command list/counters and the card timeline keep the
  same DTOs; the timeline batches side-table details by commandId, scoped to
  the card's board.
- **200.4 (aggregate load):** no new aggregate load on the command path; the
  detail insert and key upsert are rows in the same transaction.
- **200.6 (revision triggers):** none of the board-table triggers reference
  `Command`/`CommandKey`; the command write still updates `Board` as before.
- **200.7 (targeted intents):** intent planning reads the same command rows;
  `commandId` resolution remains inside the board lock, and the global key
  rejects a cross-board collision with 409.

## 8. Tests

- Unit: `command-details.spec.ts` (description/task-spec/card-order caps,
  middle reorder, byte ceiling), `command-log-partitions.spec.ts` (UTC
  boundaries, month names, expiry, no expired-month recreation),
  `maintenance.service.spec.ts` (ensure/skip/failure isolation, lock retry,
  bounded `NOT EXISTS` key sweep), `command-log-stats` / observability and the
  existing command service specs (duplicate batch ids, batched detail read).
- E2E: `command-log-partitioning.e2e-spec.ts` (routing, pruning, all 10
  indexes/FKs, board-scoped detail/no registry cascade, whole-month drop under
  a concurrent reader, default-partition skip, exact `defaultRows`/registry
  stats, move-forward key+detail retention, stale-live-key preservation,
  bounded bulk purge, >500-command board purge, deferred cleanup, wipe);
  `command-log-global-ids.e2e-spec.ts` (concurrent cross-board
  collision, no duplicate/detail leak, duplicate batch, fixed id after
  `wipeAll`); `admin-throttle-demo` covers the real demo move and purge
  erasure; `limits-data-safety` includes a preimage on account erasure;
  existing `events`, `runs`, `admin`, `commands-*` suites run on the
  partitioned schema (the fixed-id events/undo suites were run twice in a
  row).
- Migration: `backend/scripts/check-command-log-migration.cjs` (empty +
  existing data, row/detail/key counts, global-id rejection, no detail FK,
  board column/index, plan, move support, skipped default month, retention);
  wired into CI.

No Docker, Playwright or heavy load is required; the checks use the existing
PostgreSQL test server.

## 9. Residual gaps

- Exact disk-per-row was not measured at hundreds of millions of rows; the
  table in §3 is a planning estimate. Run a capacity pass before
  certifying 200.14.
- The whole migration is a stop-the-world copy (old names hold ACCESS
  EXCLUSIVE until commit); a true online backfill would need a shadow table
  plus mirror triggers, which is not worth the complexity for self-hosted
  installs.
- A month whose rows sit in the default partition is skipped and reported;
  moving those rows is an operator step (the exact detach/move/reattach SQL is
  in the runbook above).
- The registry is unpartitioned and drained by `NOT EXISTS Command` batches,
  not by month DDL; its rows/index/WAL are part of the size plan and must be
  visible in observability. A very long `retentionDays` makes this table the
  dominant cost, not the partitions.
- Per-board lock/queue and SSE fan-out are unchanged (200.6/200.13 own
  those paths).
