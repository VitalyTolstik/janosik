-- TASK-185.1 follow-up: history cleanup and trim look up Activity snapshots
-- by JSON details while the caller holds a board lock. Expression indexes
-- keep those lookups from scanning the feed on large boards.
--
-- TASK-185.2 replaces these with the typed `Activity.commentId` column and a
-- revision link; these indexes can then be dropped.

CREATE INDEX IF NOT EXISTS "Activity_commentId_expr_idx" ON "Activity" ((("details"->>'commentId')));
CREATE INDEX IF NOT EXISTS "Activity_revisionId_expr_idx" ON "Activity" ((("details"->>'revisionId')));
