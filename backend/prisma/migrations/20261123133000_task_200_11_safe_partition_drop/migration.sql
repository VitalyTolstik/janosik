-- TASK-200.11 (4/4) — safe partition drops and default-partition handling.
--
-- 1. `ensure` now detects rows parked in a default partition for the requested
--    month and returns `skipped:<table>=<rows>;...` instead of failing on
--    `CREATE TABLE ... PARTITION OF`. The maintenance job reports the skip
--    (and the observability `defaultRows` metric shows it); operators move
--    those rows before the month can be attached. A targeted skip keeps the
--    scheduler alive instead of failing every later month too.
--
-- 2. `drop` takes the same lock order readers use (Command → CommandDetail,
--    then CommandPreimage) before dropping anything, with a 2 s lock_timeout.
--    A reader holding Command and then asking for Detail can no longer meet a
--    dropper that already holds Detail and wants Command (the old 40P01
--    deadlock). A lock timeout returns -1; the service retries, then skips this
--    run. Whole-month DDL does not fire row triggers, so the key registry is
--    cleared by the same range here; the service also sweeps orphan keys.

CREATE OR REPLACE FUNCTION janosik_ensure_command_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  m            date := date_trunc('month', p_month)::date;
  suffix       text := to_char(m, 'YYYYMM');
  lo           timestamp := m::timestamp;
  hi           timestamp := (m + interval '1 month')::timestamp;
  created      text[] := ARRAY[]::text[];
  skipped      text := '';
  name         text;
  default_name text;
  parent       text;
  parents      text[] := ARRAY['Command', 'CommandDetail', 'CommandPreimage'];
  default_rows bigint;
BEGIN
  -- A default partition may only exist from the earlier migrations. Check it
  -- before creating anything so the three parents stay aligned for this month.
  FOREACH parent IN ARRAY parents LOOP
    default_name := parent || '_default';
    IF to_regclass(format('%I.%I', current_schema(), default_name)) IS NOT NULL THEN
      EXECUTE format(
        'SELECT count(*) FROM %I.%I WHERE "createdAt" >= %L AND "createdAt" < %L',
        current_schema(), default_name, lo, hi
      ) INTO default_rows;
      IF default_rows > 0 THEN
        skipped := skipped || format('%s=%s;', default_name, default_rows);
      END IF;
    END IF;
  END LOOP;

  IF skipped <> '' THEN
    RETURN 'skipped:' || skipped;
  END IF;

  FOREACH parent IN ARRAY parents LOOP
    name := parent || '_' || suffix;
    IF to_regclass(format('%I.%I', current_schema(), name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I.%I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        current_schema(), name, parent, lo, hi
      );
      created := created || name;
    END IF;
  END LOOP;
  RETURN array_to_string(created, ',');
END;
$$;

COMMENT ON FUNCTION janosik_ensure_command_partition(date) IS
  'TASK-200.11: create monthly Command/CommandDetail/CommandPreimage partitions; returns skipped:<default>=<n> when rows must be moved first.';

CREATE OR REPLACE FUNCTION janosik_drop_command_partition(p_month date)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  m           date := date_trunc('month', p_month)::date;
  suffix      text := to_char(m, 'YYYYMM');
  lo          timestamp := m::timestamp;
  hi          timestamp := (m + interval '1 month')::timestamp;
  est         bigint := 0;
  key_rows    bigint := 0;
  name        text;
  old_timeout text;
BEGIN
  name := 'Command_' || suffix;
  IF to_regclass(format('%I.%I', current_schema(), name)) IS NOT NULL THEN
    EXECUTE format(
      'SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = %L::regclass',
      format('%I.%I', current_schema(), name)
    ) INTO est;
  END IF;

  old_timeout := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  BEGIN
    -- Same order as a board read: Command, then CommandDetail. Locking the
    -- partitions (not the parent) keeps other months available.
    IF to_regclass(format('%I.%I', current_schema(), name)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), name);
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'CommandDetail_' || suffix)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), 'CommandDetail_' || suffix);
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'CommandPreimage_' || suffix)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        current_schema(), 'CommandPreimage_' || suffix);
    END IF;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected THEN
      PERFORM set_config('lock_timeout', old_timeout, true);
      RETURN -1;
  END;
  PERFORM set_config('lock_timeout', old_timeout, true);

  EXECUTE format('DROP TABLE IF EXISTS %I.%I', current_schema(), name);
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandDetail_' || suffix
  );
  EXECUTE format(
    'DROP TABLE IF EXISTS %I.%I',
    current_schema(), 'CommandPreimage_' || suffix
  );

  -- Partition DDL bypasses row triggers; release the ids by the month range.
  -- A title-only detail read can hold the key while waiting for the detail
  -- partition we just dropped, so cap this wait and leave the orphan keys to
  -- the sweep's key pass instead of failing the whole drop.
  PERFORM set_config('lock_timeout', '2s', true);
  BEGIN
    DELETE FROM "CommandKey" WHERE "createdAt" >= lo AND "createdAt" < hi;
    GET DIAGNOSTICS key_rows = ROW_COUNT;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected THEN
      key_rows := 0;
  END;
  PERFORM set_config('lock_timeout', old_timeout, true);

  -- Keys are one per command; this is exact, unlike the reltuples estimate.
  -- Fall back to the estimate only when the key rows were already gone.
  IF key_rows > 0 THEN
    RETURN key_rows;
  END IF;
  RETURN GREATEST(est, 0);
END;
$$;

COMMENT ON FUNCTION janosik_drop_command_partition(date) IS
  'TASK-200.11: lock Command→Detail→Preimage, drop one expired month, and release its CommandKey rows; -1 means lock timeout, retry.';
