-- TASK-156: index the code sweeps.
--
-- `sweep-codes` filters EmailVerificationCode/EmailChangeCode by expiry and
-- consumption with only a `userId` index, so every run was a seq scan.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailVerificationCode_expiresAt_idx"
  ON "EmailVerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailVerificationCode_consumedAt_idx"
  ON "EmailVerificationCode"("consumedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailChangeCode_expiresAt_idx"
  ON "EmailChangeCode"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailChangeCode_consumedAt_idx"
  ON "EmailChangeCode"("consumedAt");

-- A previously interrupted CONCURRENTLY build leaves a present but invalid
-- index behind; `IF NOT EXISTS` would silently keep it. Fail with an
-- actionable message instead of leaving a broken index (TASK-156).
DO $do$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE i.indisvalid = false
      AND c.relname IN (
        'Board_deletedAt_idx',
        'Column_deletedAt_idx',
        'Card_deletedAt_idx',
        'CardLink_deletedAt_idx',
        'Label_deletedAt_idx',
        'Checklist_deletedAt_idx',
        'ChecklistItem_deletedAt_idx',
        'Comment_deletedAt_idx',
        'RefreshToken_expiresAt_idx',
        'RefreshToken_revokedAt_idx',
        'AdminRefreshToken_expiresAt_idx',
        'AdminRefreshToken_revokedAt_idx',
        'BoardShare_expiresAt_idx',
        'BoardShare_revokedAt_idx',
        'BoardMember_expiresAt_idx',
        'Activity_createdAt_idx',
        'ReminderSent_dueDate_idx',
        'EmailVerificationCode_expiresAt_idx',
        'EmailVerificationCode_consumedAt_idx',
        'EmailChangeCode_expiresAt_idx',
        'EmailChangeCode_consumedAt_idx'
      )
  LOOP
    RAISE EXCEPTION
      'Index % is invalid (interrupted CREATE INDEX CONCURRENTLY). Run npm run db:indexes --workspace backend, then retry the deploy.',
      bad.name;
  END LOOP;
END $do$;