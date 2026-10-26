-- DropIndex
DROP INDEX "Command_boardId_touches_idx";

-- CreateIndex
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

-- CreateIndex
CREATE INDEX "Attachment_deletedAt_transcodeStatus_idx" ON "Attachment"("deletedAt", "transcodeStatus");

-- CreateIndex
CREATE INDEX "Attachment_deletedAt_derivativeStatus_idx" ON "Attachment"("deletedAt", "derivativeStatus");

-- CreateIndex
CREATE INDEX "Card_dueDate_idx" ON "Card"("dueDate");

-- CreateIndex
CREATE INDEX "Command_touches_idx" ON "Command" USING GIN ("touches");

-- CreateIndex
CREATE INDEX "DataExport_expiresAt_idx" ON "DataExport"("expiresAt");

-- CreateIndex
CREATE INDEX "DemoRun_status_startedAt_idx" ON "DemoRun"("status", "startedAt");
