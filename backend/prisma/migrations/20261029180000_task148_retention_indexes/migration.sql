-- TASK-148: retention sweep indexes (B8).
--
-- Every maintenance sweep filtered by a column without an index, so each run
-- was a sequential scan — and the soft-delete purge grew worse as the table
-- did (seq scan per chunk, O(n²) over a run).
--
--  * `deletedAt` on every soft-deletable parent/child the purge touches.
--  * `expiresAt`/`revokedAt` on the session, share and invitation tables.
--  * `dueDate` on the reminder dedupe markers.
--  * `createdAt` on `Activity` for the activity retention sweep.
--
-- On an existing instance with large tables, build these without a write
-- lock first (see `docs/SELF-HOSTING.md` → Operations → Upgrade):
--
--   npm run db:indexes --workspace backend
--
-- That script runs the same statements with CONCURRENTLY; `IF NOT EXISTS`
-- here then makes the migration a no-op and the deploy instant. A fresh
-- install just gets them inline.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Board_deletedAt_idx" ON "Board"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Column_deletedAt_idx" ON "Column"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Card_deletedAt_idx" ON "Card"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CardLink_deletedAt_idx" ON "CardLink"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Label_deletedAt_idx" ON "Label"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Checklist_deletedAt_idx" ON "Checklist"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChecklistItem_deletedAt_idx" ON "ChecklistItem"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_deletedAt_idx" ON "Comment"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminRefreshToken_expiresAt_idx" ON "AdminRefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminRefreshToken_revokedAt_idx" ON "AdminRefreshToken"("revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BoardShare_expiresAt_idx" ON "BoardShare"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BoardShare_revokedAt_idx" ON "BoardShare"("revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BoardMember_expiresAt_idx" ON "BoardMember"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReminderSent_dueDate_idx" ON "ReminderSent"("dueDate");