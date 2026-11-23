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
  for autovacuum. The default partition is the only place that still needs
  chunked row deletes.
- **Pruning matches every hot read.** A board feed/delta always carries
  `boardId` plus a time or `seq` bound; with 30-day retention only the current
  and previous monthly partitions are live, so `id`/`seq` probes touch two or
  three children instead of the whole history.
- **The partition count stays bounded.** One partition per month (plus a
  default) is a dozen objects; per-board partitioning would create thousands
  of partitions, make cross-board admin queries fan out, and still could not
  drop a retention window without row deletes.

`Command`, its new detail side table `CommandDetail`, `CommandPreimage` and
the unpartitioned `CommandKey` registry share the retention window. A
whole-month drop locks in reader order (Command → CommandDetail → pre-images),
drops the command and detail partitions, releases the month's keys, and then
drops the pre-images. The default partitions are the only rows left for
chunked deletes.

## 2. Schema and constraints

| Table | Key | Partition key | Notes |
| --- | --- | --- | --- |
| `Command` | `(id, createdAt)` | monthly `createdAt` | The old `id` PK is impossible on a partitioned table: PostgreSQL requires every unique constraint to contain the partition key. |
| `CommandKey` | `id` | none (global) | Unpartitioned registry that restores the old `Command_pkey` guarantee across boards and months; `boardId` scopes id-only reads/purges and `createdAt` drives month cleanup. |
| `CommandDetail` | `(commandId, createdAt)` | monthly `createdAt` | Heavy display snapshot; FK to `CommandKey`, not to `Command`. |
| `CommandPreimage` | `(commandId, createdAt)` | monthly `createdAt` | Run undo snapshots; same shape as before, now partitionable by time. |

### Why the detail table references the registry, not `Command`

A partitioned→partitioned foreign key is expanded into per-partition
constraints. PostgreSQL then refuses `DROP TABLE Command_YYYYMM` with
`constraint CommandDetail_... depends on table Command_YYYYMM`, and the only
way out is dropping the parent FK and revalidating it over the whole detail
table. That is incompatible with monthly retention.

Instead:

- `CommandKey` is unpartitioned with `id` as its primary key; a BEFORE INSERT
  trigger on `Command` claims the id in the same transaction. The old global
  idempotency guarantee therefore survives the composite `Command` key, and a
  concurrent cross-board collision answers `409 id_conflict` instead of
  writing a duplicate.
- `CommandDetail` has a real FK to `CommandKey` with `ON DELETE CASCADE`, so
  a row delete releases the detail; the detail read also filters
  `commandKey.boardId`, so it can never return another board's diff even when
  it only has ids.
- a delete trigger on `Command` releases the key; whole-month DDL bypasses
  row triggers, so the drop helper also deletes keys by month.
- every id-only purge/sweep page is additionally paired with `boardId` (or
  accepts that the key is global).

The migration keeps the ordinary `Command → Board/User` FKs (a partitioned
child referencing an unpartitioned parent is supported and does not block
month drops).

### Indexes

Every parent index is inherited by each partition:

- `Command`: PK `(id, createdAt)`, `(boardId, seq)`,
  `(boardId, createdAt, seq)`, `(createdAt)`, `(actorId, createdAt)`,
  `(type, createdAt)`, `(apiTokenId, createdAt)`,
  `(agentSessionId, createdAt)`, `(runId)`, GIN `(touches)`.
- `CommandKey`: PK `(id)`, `(createdAt)`.
- `CommandDetail`: PK `(commandId, createdAt)`, FK `commandId → CommandKey`.
  No `(createdAt)` index: months are dropped by name and reads batch by id.
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

Planning numbers (order-of-magnitude, not a benchmark claim):

| Load | Commands / 30 days | At ~0.5–1 KB/row incl. indexes | At ~2 KB/row |
| --- | --- | --- | --- |
| 25 cmds/s | ~65M | ~30–65 GB | ~130 GB |
| 50 cmds/s | ~130M | ~65–130 GB | ~260 GB |

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

Two maintenance jobs (both idempotent, part of the existing scheduler and
`POST /admin/maintenance/run`):

- `ensure-command-partitions` — ensures previous, current and the next three
  UTC months (never a month already fully outside the retention window). If a
  requested month has rows in a default partition, the SQL helper returns
  `skipped:<default>=<n>;…` and the job logs/reports the skip instead of
  failing with 23514. A `run("all")` isolates each job: a failed sweep is
  reported in the result and later jobs still run.
- `sweep-commands` — drops whole expired months via
  `janosik_drop_command_partition(date)` (Command → detail → pre-images, with
  the key rows released by month), then chunk-deletes the partial
  current/default months (pre-images first). Whole-month DDL retries a 2 s
  reader lock up to three times, then leaves the month for the next hourly
  run. Agent runs are swept afterwards by the existing `sweep-runs`.

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
  "defaultRows": 0
}
```

`partitions[].rows` comes from `pg_class.reltuples` (planner estimate) so
opening the panel does not run `count(*)` over a hundred million rows.
`defaultRows` is the opposite: an exact count over the three default
partitions. It should stay at zero; a growing default partition means an
`ensure` run was skipped or a restored row fell outside the pre-created
months, and the next `ensure` will report `skipped:` until it is moved.

## 6. Migration

Four migrations:

1. `20261123130000_task_200_11_command_log_partitioning` — partition swap.
2. `20261123131000_task_200_11_command_details_side_table` — details backfill
   and column drop.
3. `20261123132000_task_200_11_command_key_registry` — global `CommandKey`,
   triggers, detail FK.
4. `20261123133000_task_200_11_safe_partition_drop` — default-partition skip
   and lock-ordered/retrying drop helper.

**Pre-checks**

- Take a `pg_dump` (rollback is a backup restore; there is no down
  migration).
- Free space: peak is roughly **2× the current command-log size** (old +
  new table while copying).
- Stop writes/old API replicas for the **whole migration**, not just the swap.
  Migration 1 renames the old tables and then copies/builds indexes inside one
  transaction; the old names carry an ACCESS EXCLUSIVE lock until that
  transaction commits. A writer pointed at the old name during any of those
  steps blocks or fails. On a single Docker host `prisma migrate deploy` runs
  before the new API starts; on a multi-replica rollout stop all old replicas
  first and expect downtime proportional to the copy. `lock_timeout` is 30 s,
  so a competing lock fails the migration rather than hanging the boot
  indefinitely.

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
   take `Command_seq_seq` with it), advance `setval`.
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
   (`skipped:<table>=<rows>`) and expired-month guard.
2. Recreate `janosik_drop_command_partition` with the reader lock order, 2 s
   lock timeout, key-range release and `-1` retry signal.

**Empty DB:** the same steps create empty parents/partitions and drop empty
legacy tables. **Existing DB:** the automated check
(`npm run test:migration:command-log -w backend`) builds both cases on
throwaway databases: it stops before the TASK-200.11 migrations, seeds three
months of commands/details/pre-images, then applies all four and asserts
counts, routing, sequence, key uniqueness, FK cascade, the skipped default
month, pruning and retention.

**Rollout note:** after the swap, the first `ensure-command-partitions` run
is a no-op for the pre-created months; the scheduler extends the window.
Monitoring should show `defaultRows` near zero and the oldest partition
inside the retention window.

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
  detail insert and key claim are rows in the same transaction.
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
  sweep), `command-log-stats` / observability and the existing command
  service specs (duplicate batch ids, batched detail read).
- E2E: `command-log-partitioning.e2e-spec.ts` (routing, pruning, all 10
  indexes/FKs, board-scoped detail, trigger/cascade, whole-month drop under a
  concurrent reader, default-partition skip, exact `defaultRows`, wipe);
  `command-log-global-ids.e2e-spec.ts` (concurrent cross-board collision,
  no duplicate/detail leak, duplicate batch); existing `events`, `runs`,
  `admin`, `commands-*` suites run on the partitioned schema.
- Migration: `backend/scripts/check-command-log-migration.cjs` (empty +
  existing data, row/detail/key counts, global-id rejection, FK, plan,
  skipped default month, retention); wired into CI.

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
  moving those rows is still an operator step (no automatic detach/move in
  this task).
- Per-board lock/queue and SSE fan-out are unchanged (200.6/200.13 own
  those paths).
