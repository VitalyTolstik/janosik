-- TASK-200.11 — support board-scoped registry cleanup.
--
-- Purge/erasure paths delete CommandKey rows by boardId. Without this index an
-- unpartitioned 130M-row registry would seq-scan on every purge. The purge
-- itself is paged by command id; this index serves the defensive orphan pass
-- and any board-scoped audit/reconciliation query.

CREATE INDEX "CommandKey_boardId_idx" ON "CommandKey" ("boardId");
