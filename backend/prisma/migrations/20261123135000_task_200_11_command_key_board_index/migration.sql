-- TASK-200.11 — support board-scoped registry cleanup.
--
-- Purge/erasure paths delete CommandKey rows by boardId. Without this index an
-- unpartitioned 130M-row registry would seq-scan on every purge.
--
-- A plain CREATE INDEX blocks writes while it scans. This migration builds it
-- inline only for a small registry (fresh installs/CI and the normal
-- retention-sized test datasets). A large production registry is skipped and
-- the maintenance job `ensure-command-key-index` builds it with
-- CREATE INDEX CONCURRENTLY outside a transaction, so normal writes continue
-- (the build still consumes I/O and needs free disk for the index + WAL; run
-- it in a quiet window). The threshold is deliberately low: 1M rows builds in
-- seconds-to-minutes, while 100M+ should never hold a SHARE lock during boot.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  registry_rows bigint;
BEGIN
  SELECT GREATEST(reltuples, 0)::bigint
    INTO registry_rows
    FROM pg_class
   WHERE relname = 'CommandKey';

  IF COALESCE(registry_rows, 0) >= 1000000 THEN
    RAISE NOTICE
      'TASK-200.11: CommandKey has % rows; deferring CommandKey_boardId_idx to ensure-command-key-index (CREATE INDEX CONCURRENTLY)',
      registry_rows;
    RETURN;
  END IF;

  EXECUTE 'CREATE INDEX "CommandKey_boardId_idx" ON "CommandKey" ("boardId")';
END;
$$;
