-- TASK-200.6: monotonic content revision for the full board aggregate.
--
-- The ETag used to combine `MAX(Command.seq)` with `Board.updatedAt`. Neither
-- is a content revision: comments/attachments/claims/admin edits change the
-- aggregate without a command, and sweeping old Command rows can move the max
-- seq backwards. `aggregateRevision` only ever grows. It is deliberately
-- separate from `X-Board-Seq`, which keeps its SSE resume meaning.
--
-- Writers:
--   * every command already updates the Board row → BEFORE UPDATE trigger;
--   * non-command writers touch Card/Comment/Attachment/claim/admin rows →
--     statement-level Card triggers. One Board UPDATE per Card SQL statement
--     per affected board, not per row. The position writer chunks at 1 000
--     rows, so a 5 000-card rewrite costs 5 Card statements + 1 Column
--     (`bumpColumnVersion`) + 1 command Board update = 7 bumps, not one.

ALTER TABLE "Board" ADD COLUMN "aggregateRevision" BIGINT NOT NULL DEFAULT 0;

-- Backfill from the current command maximum as a starting point. Subsequent
-- revisions are trigger-driven and never decrease, even after old commands
-- are swept.
UPDATE "Board" b
SET "aggregateRevision" = COALESCE(
  (SELECT MAX(c."seq") FROM "Command" c WHERE c."boardId" = b."id"),
  0
);

-- Any direct Board update (RENAME_BOARD, workflow/policy/pause, archive,
-- admin restore, account deletion) advances the revision by at least one.
-- The depth guard prevents a second bump when the Card triggers below update
-- the Board row and already set `aggregateRevision + 1` themselves.
CREATE OR REPLACE FUNCTION janosik_bump_board_aggregate_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW."aggregateRevision" <= OLD."aggregateRevision" THEN
    NEW."aggregateRevision" := OLD."aggregateRevision" + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Board_bump_aggregate_revision" ON "Board";
CREATE TRIGGER "Board_bump_aggregate_revision"
BEFORE UPDATE ON "Board"
FOR EACH ROW
EXECUTE FUNCTION janosik_bump_board_aggregate_revision();

-- Card INSERT: one revision bump per distinct destination board.
CREATE OR REPLACE FUNCTION janosik_bump_board_revision_card_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM new_cards c
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Card_bump_board_revision_insert" ON "Card";
CREATE TRIGGER "Card_bump_board_revision_insert"
AFTER INSERT ON "Card"
REFERENCING NEW TABLE AS new_cards
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_board_revision_card_insert();

-- Card DELETE: one bump per distinct source board.
CREATE OR REPLACE FUNCTION janosik_bump_board_revision_card_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM old_cards c
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Card_bump_board_revision_delete" ON "Card";
CREATE TRIGGER "Card_bump_board_revision_delete"
AFTER DELETE ON "Card"
REFERENCING OLD TABLE AS old_cards
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_board_revision_card_delete();

-- Card UPDATE: a move can change both the source and destination board, so
-- resolve both transition tables and bump each distinct board once.
CREATE OR REPLACE FUNCTION janosik_bump_board_revision_card_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM (
      SELECT "columnId" FROM old_cards
      UNION
      SELECT "columnId" FROM new_cards
    ) changed
    JOIN "Column" col ON col."id" = changed."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Card_bump_board_revision_update" ON "Card";
CREATE TRIGGER "Card_bump_board_revision_update"
AFTER UPDATE ON "Card"
REFERENCING OLD TABLE AS old_cards NEW TABLE AS new_cards
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_board_revision_card_update();
