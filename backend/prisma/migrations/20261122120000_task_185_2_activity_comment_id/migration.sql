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

UPDATE "Activity" a
SET "commentId" = a."details"->>'commentId'
WHERE a."type" IN ('comment_added', 'comment_updated', 'comment_deleted')
  AND a."commentId" IS NULL
  AND jsonb_typeof(a."details") = 'object'
  AND jsonb_typeof(a."details"->'commentId') = 'string'
  AND a."details"->>'commentId' IS NOT NULL
  -- TASK-185.2 follow-up: a legacy id is only a real link when the comment
  -- sits on the row's own card and board. Cross-board/malformed rows stay
  -- metadata-only instead of borrowing another board's text.
  AND EXISTS (
    SELECT 1
      FROM "Comment" c
      JOIN "Card" card ON card."id" = c."cardId"
      JOIN "Column" col ON col."id" = card."columnId"
    WHERE c."id" = a."details"->>'commentId'
      AND c."cardId" = a."cardId"
      AND col."boardId" = a."boardId"
  );

CREATE INDEX "Activity_commentId_idx" ON "Activity"("commentId");

-- The 185.1 expression index served the same lookup; the typed column
-- replaces it. The revision-link expression index stays: revision ids still
-- live in `details` until a later subtask moves them.
DROP INDEX IF EXISTS "Activity_commentId_expr_idx";
