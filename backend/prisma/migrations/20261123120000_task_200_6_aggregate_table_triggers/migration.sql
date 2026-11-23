-- TASK-200.6: the remaining aggregate tables must invalidate the board read
-- validator too. The first revision migration covered Board and Card;
-- admin/demo purge paths can delete or restore Label, Column, Checklist,
-- ChecklistItem, CardLabel or CardLink rows directly without touching either.
--
-- These are AFTER STATEMENT triggers with transition tables: one Board UPDATE
-- per affected board per SQL statement, not per row. A demo purge that deletes
-- 10 000 checklist items in one statement still takes one Board row lock per
-- distinct board; chunked writers pay one bump per chunk. That is the cost we
-- document; it is deliberately not a per-row trigger.
--
-- Board resolution:
--   * Label / Column / CardLink carry boardId directly;
--   * CardLabel / Checklist resolve via Card -> Column;
--   * ChecklistItem resolves via Checklist -> Card -> Column.

-- ---------------------------------------------------------------------------
-- Direct boardId tables: Label, Column, CardLink
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_bump_boards_direct_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (SELECT DISTINCT "boardId" FROM changed_rows) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_direct_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (SELECT DISTINCT "boardId" FROM changed_rows) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_direct_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT "boardId"
    FROM (
      SELECT "boardId" FROM old_changed_rows
      UNION
      SELECT "boardId" FROM new_changed_rows
    ) changed
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Label_bump_board_revision_insert" ON "Label";
CREATE TRIGGER "Label_bump_board_revision_insert"
AFTER INSERT ON "Label"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_insert();

DROP TRIGGER IF EXISTS "Label_bump_board_revision_update" ON "Label";
CREATE TRIGGER "Label_bump_board_revision_update"
AFTER UPDATE ON "Label"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_update();

DROP TRIGGER IF EXISTS "Label_bump_board_revision_delete" ON "Label";
CREATE TRIGGER "Label_bump_board_revision_delete"
AFTER DELETE ON "Label"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_delete();

DROP TRIGGER IF EXISTS "Column_bump_board_revision_insert" ON "Column";
CREATE TRIGGER "Column_bump_board_revision_insert"
AFTER INSERT ON "Column"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_insert();

DROP TRIGGER IF EXISTS "Column_bump_board_revision_update" ON "Column";
CREATE TRIGGER "Column_bump_board_revision_update"
AFTER UPDATE ON "Column"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_update();

DROP TRIGGER IF EXISTS "Column_bump_board_revision_delete" ON "Column";
CREATE TRIGGER "Column_bump_board_revision_delete"
AFTER DELETE ON "Column"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_delete();

DROP TRIGGER IF EXISTS "CardLink_bump_board_revision_insert" ON "CardLink";
CREATE TRIGGER "CardLink_bump_board_revision_insert"
AFTER INSERT ON "CardLink"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_insert();

DROP TRIGGER IF EXISTS "CardLink_bump_board_revision_update" ON "CardLink";
CREATE TRIGGER "CardLink_bump_board_revision_update"
AFTER UPDATE ON "CardLink"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_update();

DROP TRIGGER IF EXISTS "CardLink_bump_board_revision_delete" ON "CardLink";
CREATE TRIGGER "CardLink_bump_board_revision_delete"
AFTER DELETE ON "CardLink"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_delete();

-- ---------------------------------------------------------------------------
-- Card children: CardLabel, Checklist (both expose cardId)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_card_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM changed_rows child
    JOIN "Card" c ON c."id" = child."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_card_child_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM changed_rows child
    JOIN "Card" c ON c."id" = child."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_card_child_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM (
      SELECT "cardId" FROM old_changed_rows
      UNION
      SELECT "cardId" FROM new_changed_rows
    ) changed
    JOIN "Card" c ON c."id" = changed."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "CardLabel_bump_board_revision_insert" ON "CardLabel";
CREATE TRIGGER "CardLabel_bump_board_revision_insert"
AFTER INSERT ON "CardLabel"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_insert();

DROP TRIGGER IF EXISTS "CardLabel_bump_board_revision_update" ON "CardLabel";
CREATE TRIGGER "CardLabel_bump_board_revision_update"
AFTER UPDATE ON "CardLabel"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_update();

DROP TRIGGER IF EXISTS "CardLabel_bump_board_revision_delete" ON "CardLabel";
CREATE TRIGGER "CardLabel_bump_board_revision_delete"
AFTER DELETE ON "CardLabel"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_delete();

DROP TRIGGER IF EXISTS "Checklist_bump_board_revision_insert" ON "Checklist";
CREATE TRIGGER "Checklist_bump_board_revision_insert"
AFTER INSERT ON "Checklist"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_insert();

DROP TRIGGER IF EXISTS "Checklist_bump_board_revision_update" ON "Checklist";
CREATE TRIGGER "Checklist_bump_board_revision_update"
AFTER UPDATE ON "Checklist"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_update();

DROP TRIGGER IF EXISTS "Checklist_bump_board_revision_delete" ON "Checklist";
CREATE TRIGGER "Checklist_bump_board_revision_delete"
AFTER DELETE ON "Checklist"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_card_child_delete();

-- ---------------------------------------------------------------------------
-- ChecklistItem: resolve Checklist -> Card -> Column
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_checklist_item_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM changed_rows item
    JOIN "Checklist" cl ON cl."id" = item."checklistId"
    JOIN "Card" c ON c."id" = cl."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_checklist_item_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM changed_rows item
    JOIN "Checklist" cl ON cl."id" = item."checklistId"
    JOIN "Card" c ON c."id" = cl."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION janosik_bump_boards_from_checklist_item_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Board" b
  SET "aggregateRevision" = b."aggregateRevision" + 1
  FROM (
    SELECT DISTINCT col."boardId"
    FROM (
      SELECT "checklistId" FROM old_changed_rows
      UNION
      SELECT "checklistId" FROM new_changed_rows
    ) changed
    JOIN "Checklist" cl ON cl."id" = changed."checklistId"
    JOIN "Card" c ON c."id" = cl."cardId"
    JOIN "Column" col ON col."id" = c."columnId"
  ) affected
  WHERE b."id" = affected."boardId";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "ChecklistItem_bump_board_revision_insert" ON "ChecklistItem";
CREATE TRIGGER "ChecklistItem_bump_board_revision_insert"
AFTER INSERT ON "ChecklistItem"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_checklist_item_insert();

DROP TRIGGER IF EXISTS "ChecklistItem_bump_board_revision_update" ON "ChecklistItem";
CREATE TRIGGER "ChecklistItem_bump_board_revision_update"
AFTER UPDATE ON "ChecklistItem"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_checklist_item_update();

DROP TRIGGER IF EXISTS "ChecklistItem_bump_board_revision_delete" ON "ChecklistItem";
CREATE TRIGGER "ChecklistItem_bump_board_revision_delete"
AFTER DELETE ON "ChecklistItem"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_from_checklist_item_delete();
