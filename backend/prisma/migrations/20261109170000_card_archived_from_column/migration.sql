-- TASK-165 review: remember the source column of an archived card so
-- UNARCHIVE_CARD / RESTORE_CARD can enforce the workflow from it.
ALTER TABLE "Card" ADD COLUMN "archivedFromColumnId" TEXT;

-- Backfill existing archives from their current column. A card already
-- repointed at an internal `orphan:` column keeps that id; the server treats
-- a missing source column as "deleted column" recovery.
UPDATE "Card"
SET "archivedFromColumnId" = "columnId"
WHERE "archivedAt" IS NOT NULL;
