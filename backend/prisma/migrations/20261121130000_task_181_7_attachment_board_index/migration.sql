-- TASK-181.7: board-scoped moderation is a shipped admin filter. Measure it
-- with Attachment(boardId, createdAt); the global period/MIME/uploader paths
-- keep their own indexes.
CREATE INDEX "Attachment_boardId_createdAt_idx" ON "Attachment"("boardId", "createdAt");
