-- TASK-200.11 — move pre-images with the command clock.
--
-- A Command.createdAt UPDATE (demo seed/backdate) moves the command, its
-- registry key and its display detail. CommandPreimage is partitioned by its
-- own createdAt and must follow the same month or retention can drop the
-- pre-image while the command/run is still inside the window. Recreate the two
-- trigger functions to move the pre-image rows as well.

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

  UPDATE "CommandDetail"
     SET "createdAt" = NEW."createdAt",
         "boardId" = NEW."boardId"
   WHERE "commandId" = NEW."id";
  UPDATE "CommandPreimage"
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
  UPDATE "CommandPreimage"
     SET "createdAt" = NEW."createdAt",
         "boardId" = NEW."boardId"
   WHERE "commandId" = NEW."id";

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION janosik_register_command_key() IS
  'TASK-200.11: claim/upsert the global id and move detail/preimage on a rewrite.';
COMMENT ON FUNCTION janosik_move_command_key() IS
  'TASK-200.11: move key, detail and preimages to the new Command.createdAt month.';

ANALYZE "CommandPreimage";
