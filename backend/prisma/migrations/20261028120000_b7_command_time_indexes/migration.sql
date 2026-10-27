-- B-7: time-range indexes on the command log.
-- `Command.createdAt` drives the retention sweep and the admin metrics
-- (24h/7d counts and the 14-day per-day series); without an index each of
-- them was a sequential scan of the whole log.

-- CreateIndex
CREATE INDEX "Command_createdAt_idx" ON "Command"("createdAt");

-- CreateIndex
CREATE INDEX "Command_boardId_createdAt_seq_idx" ON "Command"("boardId", "createdAt", "seq");
