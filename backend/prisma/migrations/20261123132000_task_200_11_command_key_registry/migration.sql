-- TASK-200.11 (3/4) — restore global commandId uniqueness with a registry.
--
-- The partitioned `Command` primary key is `(id, createdAt)`, because
-- PostgreSQL requires every unique constraint to include the partition key.
-- That alone allowed the same client commandId on two boards (and two months),
-- while several paths only know the id: the detail side table, purge pages,
-- the delete trigger and admin lookups. The old `Command_pkey` made ids global;
-- this migration restores that guarantee without putting the id back into the
-- partitioned key.
--
-- `CommandKey` is deliberately unpartitioned: `id` is its primary key, so the
-- same id cannot be claimed twice across boards or months. A BEFORE INSERT
-- trigger claims the id in the command's transaction; a cross-board collision
-- raises a unique violation and the API answers 409 `id_conflict`. The same
-- transaction inserts the command, so a failed claim leaves no row. A delete
-- trigger releases the id, and the retention helper deletes keys by month when
-- whole partitions are dropped (partition DDL does not fire row triggers).
--
-- `CommandDetail` now references `CommandKey` (an unpartitioned parent), which
-- cascades the side row on key deletion and gives detail reads a board scope
-- even when the caller only passes command ids. The FK must not point at
-- `Command`: that would recreate the per-partition constraint that blocks
-- `DROP TABLE Command_YYYYMM`.

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. Registry and backfill. The old pre-partition PK guaranteed no duplicate
--    ids; verify that before the primary key turns a bad row into a vague
--    constraint error.
-- ---------------------------------------------------------------------------

CREATE TABLE "CommandKey" (
  "id"        TEXT NOT NULL,
  "boardId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommandKey_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE duplicates bigint;
BEGIN
  SELECT count(*) INTO duplicates
    FROM (
      SELECT "id" FROM "Command" GROUP BY "id" HAVING count(*) > 1
    ) AS dup;
  IF duplicates > 0 THEN
    RAISE EXCEPTION
      'TASK-200.11: cannot restore global commandId uniqueness: % duplicate ids',
      duplicates;
  END IF;
END;
$$;

INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
SELECT "id", "boardId", "createdAt" FROM "Command";

DO $$
DECLARE old_commands bigint;
DECLARE keys bigint;
BEGIN
  SELECT count(*) INTO old_commands FROM "Command";
  SELECT count(*) INTO keys FROM "CommandKey";
  IF old_commands <> keys THEN
    RAISE EXCEPTION 'TASK-200.11: key backfill copied % of % commands',
      keys, old_commands;
  END IF;
END;
$$;

CREATE INDEX "CommandKey_createdAt_idx" ON "CommandKey" ("createdAt");

-- ---------------------------------------------------------------------------
-- 2. Replace the id-only detail trigger with a key cascade.
--
--    Orphan detail rows cannot be reached by a command (no FK existed before);
--    they are removed before the FK is validated. This only affects rows whose
--    command is already gone.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "Command_delete_detail" ON "Command";
DROP FUNCTION IF EXISTS janosik_delete_command_detail();

DELETE FROM "CommandDetail" d
 WHERE NOT EXISTS (
   SELECT 1 FROM "CommandKey" k WHERE k."id" = d."commandId"
 );

ALTER TABLE "CommandDetail"
  ADD CONSTRAINT "CommandDetail_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "CommandKey"("id")
  ON UPDATE CASCADE ON DELETE CASCADE;

COMMENT ON TABLE "CommandDetail" IS
  'TASK-200.11: heavy display diff, partitioned by createdAt; FK to CommandKey (never to Command) so monthly DROP works.';

-- The detail table has no retention/range read: months are dropped by name,
-- and callers batch by commandId. Drop the unused per-partition index.
DROP INDEX IF EXISTS "CommandDetail_createdAt_idx";

-- ---------------------------------------------------------------------------
-- 3. Claim/release triggers. Row triggers on a partitioned table propagate to
--    every current and future partition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_register_command_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
  VALUES (NEW."id", NEW."boardId", NEW."createdAt");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Command_register_key"
BEFORE INSERT ON "Command"
FOR EACH ROW
EXECUTE FUNCTION janosik_register_command_key();

-- Admin/demo seeds move a command's createdAt between months. Move the key too
-- so retention deletes it with the right month; recreate it if an operator
-- disabled triggers during a manual restore.
CREATE OR REPLACE FUNCTION janosik_move_command_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CommandKey" ("id", "boardId", "createdAt")
  VALUES (NEW."id", NEW."boardId", NEW."createdAt")
  ON CONFLICT ("id") DO UPDATE
    SET "createdAt" = EXCLUDED."createdAt";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Command_move_key"
AFTER UPDATE OF "createdAt" ON "Command"
FOR EACH ROW
EXECUTE FUNCTION janosik_move_command_key();

CREATE OR REPLACE FUNCTION janosik_delete_command_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "CommandKey" WHERE "id" = OLD."id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Command_delete_key"
AFTER DELETE ON "Command"
FOR EACH ROW
EXECUTE FUNCTION janosik_delete_command_key();

ANALYZE "Command";
ANALYZE "CommandDetail";
ANALYZE "CommandPreimage";
ANALYZE "CommandKey";

COMMENT ON TABLE "CommandKey" IS
  'TASK-200.11: unpartitioned global commandId registry; enforces the old Command_pkey uniqueness.';
