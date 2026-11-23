-- TASK-200.11 (5/5) — move keys and details together; registry retention.
--
-- A `Command.createdAt` UPDATE that crosses a partition boundary is executed
-- by PostgreSQL as a row move (new row + old row). The old lifecycle assumed a
-- plain INSERT/BEFORE DELETE order: the insert trigger hit the existing
-- `CommandKey` PK and the delete trigger removed the key (cascading the detail
-- row). A demo/seed backdate therefore failed with a unique violation or lost
-- the display snapshot.
--
-- This migration changes the lifecycle:
--   * the INSERT trigger upserts the key for the same board and still raises
--     23505 for a cross-board id (global uniqueness preserved);
--   * the UPDATE trigger moves both the key and `CommandDetail.createdAt`;
--   * the DELETE trigger is deferred and removes only the detail when no
--     Command with that id/board remains; it never releases `CommandKey`;
--   * orphan keys are deleted in batches by the maintenance sweep (the
--     registry is unpartitioned, so a month DDL does not touch it);
--   * `CommandDetail` no longer has an FK to the registry. Board scoping moves
--     to an explicit `boardId` column, and the detail row is not cascaded by
--     a key delete/move.
--
-- Retention drops the Command/Detail/Preimage partitions; the next sweep
-- deletes the month's keys through the bounded orphan query (NOT EXISTS
-- Command). That keeps the large unpartitioned registry out of the DDL path.

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. Detail board scope and FK removal.
-- ---------------------------------------------------------------------------

ALTER TABLE "CommandDetail" ADD COLUMN "boardId" TEXT;

UPDATE "CommandDetail" d
   SET "boardId" = k."boardId"
  FROM "CommandKey" k
 WHERE k."id" = d."commandId";

-- An orphan detail row cannot be read by any command; migration 3 already
-- removed pre-existing ones. Keep the NOT NULL guarantee explicit.
DELETE FROM "CommandDetail" WHERE "boardId" IS NULL;
ALTER TABLE "CommandDetail" ALTER COLUMN "boardId" SET NOT NULL;

ALTER TABLE "CommandDetail"
  DROP CONSTRAINT IF EXISTS "CommandDetail_commandId_fkey";

CREATE INDEX "CommandDetail_boardId_commandId_idx"
  ON "CommandDetail" ("boardId", "commandId");

-- ---------------------------------------------------------------------------
-- 2. Key/detail lifecycle triggers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_register_command_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
  VALUES (NEW."id", NEW."boardId", NEW."createdAt")
  ON CONFLICT ("id") DO UPDATE
    SET "createdAt" = EXCLUDED."createdAt"
    WHERE "CommandKey"."boardId" = EXCLUDED."boardId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'command id already used on another board'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- A cross-partition UPDATE becomes INSERT + DELETE. The UPDATE trigger is
  -- not guaranteed to fire in that path, so the insert half also moves an
  -- existing display snapshot to the new month.
  UPDATE "CommandDetail"
     SET "createdAt" = NEW."createdAt",
         "boardId" = NEW."boardId"
   WHERE "commandId" = NEW."id";

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_move_command_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
  VALUES (NEW."id", NEW."boardId", NEW."createdAt")
  ON CONFLICT ("id") DO UPDATE
    SET "createdAt" = EXCLUDED."createdAt"
    WHERE "CommandKey"."boardId" = EXCLUDED."boardId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'command id already used on another board'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE "CommandDetail"
     SET "createdAt" = NEW."createdAt",
         "boardId" = NEW."boardId"
   WHERE "commandId" = NEW."id";

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_delete_command_detail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Deferred to transaction end: during a row move the replacement Command
  -- row is already present, so the detail (and the registry key) must stay.
  IF NOT EXISTS (
    SELECT 1 FROM "Command"
     WHERE "id" = OLD."id" AND "boardId" = OLD."boardId"
  ) THEN
    DELETE FROM "CommandDetail"
     WHERE "commandId" = OLD."id" AND "boardId" = OLD."boardId";
  END IF;
  RETURN OLD;
END;
$$;

-- The old immediate key release is replaced by the deferred detail cleanup.
DROP TRIGGER IF EXISTS "Command_delete_key" ON "Command";
DROP FUNCTION IF EXISTS janosik_delete_command_key();

CREATE CONSTRAINT TRIGGER "Command_delete_detail"
AFTER DELETE ON "Command"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION janosik_delete_command_detail();

COMMENT ON FUNCTION janosik_register_command_key() IS
  'TASK-200.11: claim/upsert the global id; a different board raises 23505.';
COMMENT ON FUNCTION janosik_move_command_key() IS
  'TASK-200.11: move key and detail to the new Command.createdAt month.';
COMMENT ON FUNCTION janosik_delete_command_detail() IS
  'TASK-200.11: deferred detail cleanup; a row move keeps the detail.';

-- ---------------------------------------------------------------------------
-- 3. Month drop no longer deletes keys inline. The unpartitioned registry is
--    drained by the sweep's NOT EXISTS key pass in bounded chunks; the DDL
--    returns the Command partition's reltuples estimate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_drop_command_partition(p_month date)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  m           date := date_trunc('month', p_month)::date;
  suffix      text := to_char(m, 'YYYYMM');
  est         bigint := 0;
  name        text;
  old_timeout text;
BEGIN
  name := 'Command_' || suffix;
  IF to_regclass(format('%I.%I', current_schema(), name)) IS NOT NULL THEN
    EXECUTE format(
      'SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = %L::regclass',
      format('%I.%I', current_schema(), name)
    ) INTO est;
  END IF;

  old_timeout := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  BEGIN
    IF to_regclass(format('%I.%I', current_schema(), name)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), name);
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'CommandDetail_' || suffix)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), 'CommandDetail_' || suffix);
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'CommandPreimage_' || suffix)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), 'CommandPreimage_' || suffix);
    END IF;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected THEN
      PERFORM set_config('lock_timeout', old_timeout, true);
      RETURN -1;
  END;
  PERFORM set_config('lock_timeout', old_timeout, true);

  EXECUTE format('DROP TABLE IF EXISTS %I.%I', current_schema(), name);
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandDetail_' || suffix
  );
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandPreimage_' || suffix
  );

  -- Keys are drained by maintenance (NOT EXISTS Command) in chunks.
  RETURN GREATEST(est, 0);
END;
$$;

COMMENT ON FUNCTION janosik_drop_command_partition(date) IS
  'TASK-200.11: lock Command→Detail→Preimage and drop one expired month; keys are swept separately; -1 means retry.';

ANALYZE "CommandKey";
ANALYZE "CommandDetail";
