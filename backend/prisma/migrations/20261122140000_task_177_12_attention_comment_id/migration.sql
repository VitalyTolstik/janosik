-- TASK-177.12: exact comment target on attention rows.
--
-- Prefix deletion on the dedup key needed LIKE escaping, and GDPR/admin
-- cleanup had to discover authored comments before it could remove the rows
-- owned by other recipients. The nullable column is deliberately not an FK:
-- a hard-purged comment must not block the attention retention sweep, and a
-- soft-deleted comment keeps its tombstones long enough to clean up.

ALTER TABLE "AttentionNotification" ADD COLUMN "commentId" TEXT;

-- Backfill the mention rows introduced by this task. Other categories keep
-- `commentId` NULL; their `data` may still carry a comment id as context.
UPDATE "AttentionNotification"
SET "commentId" = "data"->>'commentId'
WHERE "type" = 'comment.mention'
  AND "commentId" IS NULL
  AND jsonb_typeof("data") = 'object'
  AND jsonb_typeof("data"->'commentId') = 'string'
  AND "data"->>'commentId' IS NOT NULL;

CREATE INDEX "AttentionNotification_commentId_idx"
  ON "AttentionNotification"("commentId");
