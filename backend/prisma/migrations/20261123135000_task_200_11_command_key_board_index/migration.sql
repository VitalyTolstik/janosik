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
-- it in a quiet window). The threshold is deliberately low: under 1M rows
-- and 64 MiB builds in seconds-to-minutes, while a production registry should
-- never hold a SHARE lock during boot; stale reltuples/relpages cannot defeat
-- the physical-size check.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  registry_rows bigint;
  registry_bytes bigint;
  registry_pages_bytes bigint;
BEGIN
  SELECT GREATEST(c.reltuples, 0)::bigint,
         pg_total_relation_size(c.oid)::bigint,
         GREATEST(c.relpages, 0)::bigint * 8192
    INTO registry_rows, registry_bytes, registry_pages_bytes
    FROM pg_class c
   WHERE c.relname = 'CommandKey'
     AND c.relnamespace = current_schema()::regnamespace;

  -- reltuples and relpages can be stale after a restore/bulk load; the
  -- physical size is the independent trigger. Any of the three crossing the
  -- bound defers, so a 100M-row registry with zeroed statistics cannot take a
  -- blocking SHARE lock at boot. 64 MiB is far below production and
  -- comfortably above the tiny CI/test table.
  IF COALESCE(registry_bytes, 0) >= 67108864
     OR COALESCE(registry_pages_bytes, 0) >= 67108864
     OR COALESCE(registry_rows, 0) >= 1000000 THEN
    RAISE NOTICE
      'TASK-200.11: CommandKey is % bytes (% pages-bytes) / % rows; deferring CommandKey_boardId_idx to ensure-command-key-index (CREATE INDEX CONCURRENTLY)',
      registry_bytes, registry_pages_bytes, registry_rows;
    RETURN;
  END IF;

  EXECUTE 'CREATE INDEX "CommandKey_boardId_idx" ON "CommandKey" ("boardId")';
END;
$$;
