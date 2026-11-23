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

`Command`, its new detail side table `CommandDetail`, and `CommandPreimage`
all use the same monthly boundary. Retention drops the detail partition first,
then the command partition (a partitioned→partitioned FK would otherwise
block the drop), then the pre-images.

## 2. Schema and constraints

| Table | Key | Partition key | Notes |
| --- | --- | --- | --- |
| `Command` | `(id, createdAt)` | monthly `createdAt` | The old `id` PK is impossible on a partitioned table: PostgreSQL requires every unique constraint to contain the partition key. `id` stays the client commandId and is still unique per board through the serialized board-write transaction. |
| `CommandDetail` | `(commandId, createdAt)` | monthly `createdAt` | Heavy display snapshot (`details`); 1 data row per command that has a diff. No FK/relation to `Command` — see below. |
| `CommandPreimage` | `(commandId, createdAt)` | monthly `createdAt` | Run undo snapshots; same shape as before, now partitionable by time. |

### Why `CommandDetail` has no FK

A partitioned→partitioned foreign key is expanded into per-partition
constraints. PostgreSQL then refuses `DROP TABLE Command_YYYYMM` with
`constraint CommandDetail_... depends on table Command_YYYYMM`, and the only
way out is dropping the parent FK and revalidating it over the whole detail
table. That is incompatible with monthly retention.

Instead:

- the writer inserts `Command` and `CommandDetail` in the same transaction;
- `CommandDetail` is read in batches by `commandId` (the PK prefix), not by a
  relation keyed on `(commandId, createdAt)` — this also survives the demo
  seed moving a command's `createdAt`;
- an `AFTER DELETE` trigger removes the side row on any row delete (board,
  account, demo purge, current-month chunk retention);
- whole-month retention drops the detail partition before the command
  partition, so no trigger/row delete is involved.

The migration keeps the ordinary `Command → Board/User` FKs (a partitioned
child referencing an unpartitioned parent is supported and does not block
month drops).

### Indexes

Every parent index is inherited by each partition:

- `Command`: PK `(id, createdAt)`, `(boardId, seq)`,
  `(boardId, createdAt, seq)`, `(createdAt)`, `(actorId, createdAt)`,
  `(type, createdAt)`, `(apiTokenId, createdAt)`,
  `(agentSessionId, createdAt)`, `(runId)`, GIN `(touches)`.
- `CommandDetail`: PK `(commandId, createdAt)`, `(createdAt)`.
- `CommandPreimage`: PK `(commandId, createdAt)`, `(boardId, runId)`,
  `(createdAt)`.

## 3. Size plan (30 days does not become unbounded)

The storage levers, in order of impact:

1. **Month drop.** The 30-day window is bounded by construction; old months
   are not deleted row by row and leave no dead heap.
2. **Detail size caps.** `commandDetails` now clips every snapshot string to
   1 024 characters (head + tail, or a window around the first difference for
   description edits) and enforces a 16 KiB serialized ceiling. A 64 000-
   character description edit used to freeze two 64k walls per keystroke;
   it now stores at most ~1 KiB per side.
3. **Side table.** Heavy diffs no longer sit in the hot command row; the
   command heap keeps the replay payload/result, which are required for
   resync and audit. Both are JSONB and TOAST-compressed when large.
4. **Pre-images are only for runs** (PAT batch/plan/destructive apply); ordinary
   human/browser commands do not write one.
5. **Retention knob.** `OpsSettings.retentionDays` / `PURGE_AFTER_DAYS`
   controls the whole window; lowering it changes the monthly drop point.

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
  UTC months. DDL helper:
  `janosik_ensure_command_partition(date)`; creating a partition also creates
  every parent index on it.
- `sweep-commands` — drops whole expired months via
  `janosik_drop_command_partition(date)` (detail → command → pre-images),
  then chunk-deletes the partial current/default months (pre-images first).
  Agent runs are swept afterwards by the existing `sweep-runs`.

`GET /admin/observability` now includes `commandLog`:

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

`rows` comes from `pg_class.reltuples` (planner estimate) so opening the
panel does not run `count(*)` over a hundred million rows. `defaultRows`
should stay at zero; a growing default partition means an `ensure` run was
missed or a clock injected rows outside the pre-created months.

## 6. Migration

Migration: `20261123130000_task_200_11_command_log_partitioning` (partition
swap) followed by `20261123131000_task_200_11_command_details_side_table`
(backfill, drop the old column, trigger).

**Pre-checks**

- Take a `pg_dump` (rollback is a backup restore; there is no down
  migration).
- Free space: peak is roughly **2× the current command-log size** (old +
  new table while copying).
- Stop writes/old API replicas. The migration renames `Command` and
  `CommandPreimage` aside, copies, verifies and swaps; the copy itself runs
  on new tables, but an old writer pointed at the old table during the swap
  would lose rows. On a single Docker host `prisma migrate deploy` runs
  before the new API starts; on a multi-replica rollout stop all old
  replicas first. `lock_timeout` is 30 s, so a competing lock fails the
  migration rather than hanging the boot indefinitely.

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
4. `ALTER TABLE Command DROP COLUMN details` (metadata-only on a partitioned
   table), build the detail PK/index and the row-delete trigger.

**Empty DB:** the same steps create empty parents/partitions and drop empty
legacy tables. **Existing DB:** the automated check
(`npm run test:migration:command-log -w backend`) builds both cases on
throwaway databases: it stops before the TASK-200.11 migrations, seeds three
months of commands/details/pre-images, then applies both and asserts counts,
routing, sequence, trigger deletion, pruning and retention.

**Rollout note:** after the swap, the first `ensure-command-partitions` run
is a no-op for the pre-created months; the scheduler extends the window.
Monitoring should show `defaultRows` near zero and the oldest partition
inside the retention window.

## 7. Compatibility with the other TASK-200 work

- **Replay/resync (200.2/200.13):** `deltaSince` still returns `detail`; it
  now loads the detail side table in one batch per page. The `seq` baseline
  and `resync` contract are unchanged.
- **Undo (166/180):** pre-images keep their exact JSON shape; run analysis
  reads by `(boardId, runId)` and command ids. Rolling a run back still steps
  the pre-images in reverse order.
- **Admin (176/181):** command list/counters and the card timeline keep the
  same DTOs; the timeline batches side-table details by commandId.
- **200.4 (aggregate load):** no new aggregate load on the command path; the
  detail insert is one row in the same transaction.
- **200.6 (revision triggers):** none of the board-table triggers reference
  `Command`; the command write still updates `Board` as before.
- **200.7 (targeted intents):** intent planning reads the same command rows;
  `commandId` resolution remains inside the board lock.

## 8. Tests

- Unit: `command-details.spec.ts` (description/detail caps, byte ceiling),
  `command-log-partitions.spec.ts` (UTC boundaries, month names, expiry),
  `maintenance.service.spec.ts` (ensure/drop jobs), plus the existing command
  service specs with the batched detail read.
- E2E: `command-log-partitioning.e2e-spec.ts` (routing, pruning, detail
  batching, trigger deletion, whole-month drop, PK/index set, no FK, shared
  sequence); existing `events`, `runs`, `admin`, `commands-*` suites run on
  the partitioned schema.
- Migration: `backend/scripts/check-command-log-migration.cjs` (empty +
  existing data, row counts, backfill, plan, retention).

No Docker, Playwright or heavy load is required; the checks use the existing
PostgreSQL test server.

## 9. Residual gaps

- Exact disk-per-row was not measured at hundreds of millions of rows; the
  table in §3 is a planning estimate. Run a capacity pass before
  certifying 200.14.
- The migration has a stop-the-world window around the swap; a true online
  backfill would need a shadow table plus mirror triggers, which is not
  worth the complexity for self-hosted installs.
- Per-board lock/queue and SSE fan-out are unchanged (200.6/200.13 own
  those paths).
