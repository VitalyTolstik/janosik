-- TASK-185.2: typed comment link on Activity.
--
-- `comment_updated` filtering, revision-link checks and 185.3+ history reads
-- stop scanning a JSON expression. The column deliberately has no FK: a
-- `comment_added` / `comment_deleted` tombstone must outlive a hard-purged
-- comment, and the live-comment predicate applies only to edits.
--
-- Backfill copies the legacy string `details.commentId` for every comment
-- event, including rows whose comment (or parent) is already deleted. No
-- revision is synthesised and no text changes.

ALTER TABLE "Activity" ADD COLUMN "commentId" TEXT;

UPDATE "Activity"
SET "commentId" = "details"->>'commentId'
WHERE "type" IN ('comment_added', 'comment_updated', 'comment_deleted')
  AND "commentId" IS NULL
  AND jsonb_typeof("details") = 'object'
  AND jsonb_typeof("details"->'commentId') = 'string'
  AND "details"->>'commentId' IS NOT NULL;

CREATE INDEX "Activity_commentId_idx" ON "Activity"("commentId");

-- The 185.1 expression index served the same lookup; the typed column
-- replaces it. The revision-link expression index stays: revision ids still
-- live in `details` until a later subtask moves them.
DROP INDEX IF EXISTS "Activity_commentId_expr_idx";
