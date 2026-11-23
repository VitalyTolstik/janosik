-- TASK-200.11 (1/2) — range-partition the command log by month.
--
-- Why monthly RANGE partitions (not per-board):
--   * retention is time-based (`createdAt`), so a finished month is removed
--     with DROP TABLE — metadata work, not a 100M-row DELETE that leaves a
--     bloated heap for autovacuum;
--   * the board feed and delta reads always carry `boardId` plus a time or
--     seq bound, so partition pruning keeps the working set at two or three
--     monthly partitions even with thousands of boards;
--   * a per-board scheme would need one partition per board (thousands) and
--     could not drop a retention window without deleting rows.
--
-- PostgreSQL requires every unique constraint on a partitioned table to
-- include the partition key. `Command` therefore gets PRIMARY KEY
-- (`id`, `createdAt`) instead of (`id`). Application idempotency is unchanged:
-- every apply resolves commandIds inside the serialized per-board write
-- transaction and a same-board retry returns the stored result.
--
-- The second migration moves the heavy `details` column into a side table and
-- extends the helpers below to it. This one keeps `details` on `Command`, so
-- the swap itself is purely a partitioning change.
--
-- Peak disk while this migration runs is roughly 2× the current command log
-- (old table + new table). Take a `pg_dump` first. The migration verifies the
-- row counts before it drops the legacy tables; any mismatch raises and the
-- whole migration transaction rolls back.

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. DDL helpers used by maintenance (created before the swap so the
--    migration itself can pre-create partitions).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_ensure_command_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  m       date := date_trunc('month', p_month)::date;
  suffix  text := to_char(m, 'YYYYMM');
  lo      timestamp := m::timestamp;
  hi      timestamp := (m + interval '1 month')::timestamp;
  created text[] := ARRAY[]::text[];
  name    text;
  parent  text;
  parents text[] := ARRAY['Command', 'CommandPreimage'];
BEGIN
  FOREACH parent IN ARRAY parents LOOP
    name := parent || '_' || suffix;
    IF to_regclass(format('%I.%I', current_schema(), name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I.%I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        current_schema(), name, parent, lo, hi
      );
      created := created || name;
    END IF;
  END LOOP;
  RETURN array_to_string(created, ',');
END;
$$;

COMMENT ON FUNCTION janosik_ensure_command_partition(date) IS
  'TASK-200.11: idempotently create the monthly Command/CommandPreimage partitions.';

CREATE OR REPLACE FUNCTION janosik_drop_command_partition(p_month date)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  m       date := date_trunc('month', p_month)::date;
  suffix  text := to_char(m, 'YYYYMM');
  est     bigint := 0;
  name    text;
BEGIN
  name := 'Command_' || suffix;
  IF to_regclass(format('%I.%I', current_schema(), name)) IS NOT NULL THEN
    EXECUTE format(
      'SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = %L::regclass',
      format('%I.%I', current_schema(), name)
    ) INTO est;
  END IF;
  EXECUTE format('DROP TABLE IF EXISTS %I.%I', current_schema(), name);
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandPreimage_' || suffix
  );
  RETURN GREATEST(est, 0);
END;
$$;

COMMENT ON FUNCTION janosik_drop_command_partition(date) IS
  'TASK-200.11: drop one expired month of the command log and its pre-images.';

-- ---------------------------------------------------------------------------
-- 2. Move the legacy tables aside. Everything below runs in the same
--    transaction: the old table names keep an ACCESS EXCLUSIVE lock until
--    commit, including the copy and index builds. Treat the whole migration as
--    downtime; stop writers/old API replicas first. The new tables are unused
--    until the transaction commits.
-- ---------------------------------------------------------------------------

ALTER TABLE "CommandPreimage" RENAME TO "CommandPreimage_legacy_task20011";
ALTER TABLE "Command" RENAME TO "Command_legacy_task20011";

-- Free the canonical constraint/index names for the new tables. Constraint
-- renames carry their indexes; only plain indexes need the second loop.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = '"Command_legacy_task20011"'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE "Command_legacy_task20011" RENAME CONSTRAINT %I TO %I',
      r.conname, 'legacy_' || r.conname
    );
  END LOOP;
  FOR r IN
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'Command_legacy_task20011'
       AND indexname NOT LIKE 'legacy\_%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'legacy_' || r.indexname);
  END LOOP;
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = '"CommandPreimage_legacy_task20011"'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE "CommandPreimage_legacy_task20011" RENAME CONSTRAINT %I TO %I',
      r.conname, 'legacy_' || r.conname
    );
  END LOOP;
  FOR r IN
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'CommandPreimage_legacy_task20011'
       AND indexname NOT LIKE 'legacy\_%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'legacy_' || r.indexname);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. New partitioned parents. No PK/index yet: the copy stays a plain heap
--    per partition and the indexes are built once after it.
-- ---------------------------------------------------------------------------

CREATE TABLE "Command" (
  "id"             TEXT NOT NULL,
  "boardId"        TEXT NOT NULL,
  "actorId"        TEXT NOT NULL,
  "seq"            BIGINT NOT NULL DEFAULT nextval('"Command_seq_seq"'),
  "type"           TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "result"         JSONB NOT NULL,
  "details"        JSONB,
  "touches"        TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorType"      TEXT NOT NULL DEFAULT 'human',
  "agentName"      TEXT,
  "agentSessionId" TEXT,
  "apiTokenId"     TEXT,
  "runId"          TEXT
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "CommandPreimage" (
  "commandId" TEXT NOT NULL,
  "boardId"   TEXT NOT NULL,
  "runId"     TEXT,
  "data"      JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE ("createdAt");

-- Every month that already has rows, plus the current window and three future
-- months (the runtime job keeps extending the future window). The default
-- partition is a safety net for clock skew/restored data, not the normal path.
DO $$
DECLARE m date;
BEGIN
  FOR m IN
    SELECT DISTINCT date_trunc('month', "createdAt")::date
      FROM "Command_legacy_task20011"
     ORDER BY 1
  LOOP
    PERFORM janosik_ensure_command_partition(m);
  END LOOP;

  -- A pre-image can cross a month boundary a few milliseconds after its
  -- command; give those months a partition too.
  FOR m IN
    SELECT DISTINCT date_trunc('month', "createdAt")::date
      FROM "CommandPreimage_legacy_task20011"
     ORDER BY 1
  LOOP
    PERFORM janosik_ensure_command_partition(m);
  END LOOP;

  FOR m IN
    SELECT generate_series(
      date_trunc('month', (now() AT TIME ZONE 'UTC'))::date - interval '1 month',
      date_trunc('month', (now() AT TIME ZONE 'UTC'))::date + interval '3 months',
      interval '1 month'
    )::date
  LOOP
    PERFORM janosik_ensure_command_partition(m);
  END LOOP;
END;
$$;

CREATE TABLE "Command_default" PARTITION OF "Command" DEFAULT;
CREATE TABLE "CommandPreimage_default" PARTITION OF "CommandPreimage" DEFAULT;

-- ---------------------------------------------------------------------------
-- 4. Backfill. Explicit column lists; `details` still belongs to Command in
--    this step, `seq` keeps its values and the shared sequence.
-- ---------------------------------------------------------------------------

INSERT INTO "Command" (
  "id", "boardId", "actorId", "seq", "type", "payload", "result", "details",
  "touches", "createdAt", "actorType", "agentName", "agentSessionId",
  "apiTokenId", "runId"
)
SELECT
  "id", "boardId", "actorId", "seq", "type", "payload", "result", "details",
  "touches", "createdAt", "actorType", "agentName", "agentSessionId",
  "apiTokenId", "runId"
FROM "Command_legacy_task20011";

INSERT INTO "CommandPreimage" ("commandId", "boardId", "runId", "data", "createdAt")
SELECT "commandId", "boardId", "runId", "data", "createdAt"
  FROM "CommandPreimage_legacy_task20011";

-- Verify before anything is dropped. A partial copy must roll back.
DO $$
DECLARE
  old_commands bigint;
  new_commands bigint;
  old_details  bigint;
  new_details  bigint;
  old_pre      bigint;
  new_pre      bigint;
BEGIN
  SELECT count(*) INTO old_commands FROM "Command_legacy_task20011";
  SELECT count(*) INTO new_commands FROM "Command";
  IF old_commands <> new_commands THEN
    RAISE EXCEPTION 'TASK-200.11: command backfill copied % of % rows',
      new_commands, old_commands;
  END IF;

  SELECT count(*) INTO old_details
    FROM "Command_legacy_task20011" WHERE "details" IS NOT NULL;
  SELECT count(*) INTO new_details FROM "Command" WHERE "details" IS NOT NULL;
  IF old_details <> new_details THEN
    RAISE EXCEPTION 'TASK-200.11: command detail values copied % of % rows',
      new_details, old_details;
  END IF;

  SELECT count(*) INTO old_pre FROM "CommandPreimage_legacy_task20011";
  SELECT count(*) INTO new_pre FROM "CommandPreimage";
  IF old_pre <> new_pre THEN
    RAISE EXCEPTION 'TASK-200.11: preimage backfill copied % of % rows',
      new_pre, old_pre;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Constraints and indexes. Parent indexes are created once and PostgreSQL
--    builds them on every attached partition.
-- ---------------------------------------------------------------------------

ALTER TABLE "Command" ADD CONSTRAINT "Command_pkey"
  PRIMARY KEY ("id", "createdAt");

CREATE INDEX "Command_boardId_seq_idx" ON "Command" ("boardId", "seq");
CREATE INDEX "Command_touches_idx" ON "Command" USING GIN ("touches");
CREATE INDEX "Command_createdAt_idx" ON "Command" ("createdAt");
CREATE INDEX "Command_boardId_createdAt_seq_idx"
  ON "Command" ("boardId", "createdAt", "seq");
CREATE INDEX "Command_actorId_createdAt_idx" ON "Command" ("actorId", "createdAt");
CREATE INDEX "Command_type_createdAt_idx" ON "Command" ("type", "createdAt");
CREATE INDEX "Command_apiTokenId_createdAt_idx"
  ON "Command" ("apiTokenId", "createdAt");
CREATE INDEX "Command_agentSessionId_createdAt_idx"
  ON "Command" ("agentSessionId", "createdAt");
CREATE INDEX "Command_runId_idx" ON "Command" ("runId");

ALTER TABLE "CommandPreimage" ADD CONSTRAINT "CommandPreimage_pkey"
  PRIMARY KEY ("commandId", "createdAt");
CREATE INDEX "CommandPreimage_boardId_runId_idx"
  ON "CommandPreimage" ("boardId", "runId");
CREATE INDEX "CommandPreimage_createdAt_idx" ON "CommandPreimage" ("createdAt");

ALTER TABLE "Command"
  ADD CONSTRAINT "Command_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Command"
  ADD CONSTRAINT "Command_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 6. Sequence ownership moves to the new table before the legacy table is
--    dropped (otherwise the drop would take the sequence with it).
-- ---------------------------------------------------------------------------

ALTER SEQUENCE "Command_seq_seq" OWNED BY NONE;
ALTER SEQUENCE "Command_seq_seq" OWNED BY "Command"."seq";

DO $$
DECLARE maxseq bigint;
BEGIN
  SELECT COALESCE(max("seq"), 0) INTO maxseq FROM "Command";
  PERFORM setval('"Command_seq_seq"', GREATEST(maxseq, 1), maxseq > 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Legacy tables are only a copy source now; verification above passed.
--    Rollback is a database backup restore (take one before upgrading), not a
--    retained duplicate that doubles the 30-day footprint.
-- ---------------------------------------------------------------------------

DROP TABLE "CommandPreimage_legacy_task20011";
DROP TABLE "Command_legacy_task20011";

COMMENT ON TABLE "Command" IS
  'TASK-200.11: monthly RANGE partitions by createdAt; retention drops whole months.';
COMMENT ON TABLE "CommandPreimage" IS
  'TASK-200.11: run pre-images, monthly RANGE partitions by createdAt.';
