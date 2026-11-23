-- TASK-200.11 (2/2) — move heavy display details out of the command log.
--
-- `details` is the frozen "from → to" snapshot rendered by the history feed.
-- It is the widest column on the hot table (a 64 000-character description
-- edit used to freeze two 64k walls per command), and it is only read for a
-- small window of history. It moves to `CommandDetail`, partitioned by the
-- command's `createdAt` so retention drops the pair together.
--
-- Postgres limitation: a partitioned→partitioned FK is expanded into
-- per-partition constraints, and `DROP TABLE Command_YYYYMM` then fails until
-- the parent constraint is dropped and revalidated over the whole detail
-- table. The side table therefore has no FK. The writer inserts both rows in
-- one transaction; an AFTER DELETE trigger removes the side row on row deletes
-- (board/account/demo purge, partial-month chunk retention), while whole-month
-- retention drops the detail partition before the command partition. Reads
-- batch by `commandId` (the PK prefix), not by a `(commandId, createdAt)`
-- relation, so a demo seed moving a command's `createdAt` cannot orphan the
-- display snapshot.

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = 0;

-- Extend the maintenance helpers to the side table. Running this after the
-- Command/CommandPreimage partitions exist is fine: IF NOT EXISTS keeps them.
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
  parents text[] := ARRAY['Command', 'CommandDetail', 'CommandPreimage'];
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
  'TASK-200.11: idempotently create the monthly Command/CommandDetail/CommandPreimage partitions.';

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
  -- The side table has no FK, but dropping it first keeps the logical order
  -- and lets a whole-month drop proceed without row deletes/triggers.
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandDetail_' || suffix
  );
  EXECUTE format('DROP TABLE IF EXISTS %I.%I', current_schema(), name);
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandPreimage_' || suffix
  );
  RETURN GREATEST(est, 0);
END;
$$;

COMMENT ON FUNCTION janosik_drop_command_partition(date) IS
  'TASK-200.11: drop one expired month of the command log, detail side table and pre-images.';

-- ---------------------------------------------------------------------------
-- 1. Side table and its partitions.
-- ---------------------------------------------------------------------------

CREATE TABLE "CommandDetail" (
  "commandId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data"      JSONB NOT NULL
) PARTITION BY RANGE ("createdAt");

DO $$
DECLARE m date;
BEGIN
  FOR m IN
    SELECT DISTINCT date_trunc('month', "createdAt")::date
      FROM "Command"
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

CREATE TABLE "CommandDetail_default" PARTITION OF "CommandDetail" DEFAULT;

-- ---------------------------------------------------------------------------
-- 2. Backfill, verify, then remove the column. Dropping a column from a
--    partitioned table is metadata work (it recurses to the partitions).
-- ---------------------------------------------------------------------------

INSERT INTO "CommandDetail" ("commandId", "createdAt", "data")
SELECT "id", "createdAt", "details"
  FROM "Command"
 WHERE "details" IS NOT NULL;

DO $$
DECLARE
  old_details bigint;
  new_details bigint;
BEGIN
  SELECT count(*) INTO old_details FROM "Command" WHERE "details" IS NOT NULL;
  SELECT count(*) INTO new_details FROM "CommandDetail";
  IF old_details <> new_details THEN
    RAISE EXCEPTION 'TASK-200.11: detail backfill copied % of % rows',
      new_details, old_details;
  END IF;
END;
$$;

ALTER TABLE "Command" DROP COLUMN "details";

ALTER TABLE "CommandDetail" ADD CONSTRAINT "CommandDetail_pkey"
  PRIMARY KEY ("commandId", "createdAt");
CREATE INDEX "CommandDetail_createdAt_idx" ON "CommandDetail" ("createdAt");

-- ---------------------------------------------------------------------------
-- 3. Row-delete cleanup. Whole-month retention drops the detail partition
--    before the command partition; this trigger covers every row-by-row path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_delete_command_detail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "CommandDetail" WHERE "commandId" = OLD."id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Command_delete_detail"
AFTER DELETE ON "Command"
FOR EACH ROW
EXECUTE FUNCTION janosik_delete_command_detail();

COMMENT ON TABLE "CommandDetail" IS
  'TASK-200.11: heavy display diff, partitioned by the command createdAt; no FK so monthly DROP works.';
