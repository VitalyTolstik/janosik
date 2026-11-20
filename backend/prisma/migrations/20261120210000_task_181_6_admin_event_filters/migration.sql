-- Audit hub page and exact count predicates (TASK-181.6).
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "Command_actorId_createdAt_idx" ON "Command"("actorId", "createdAt");
CREATE INDEX "Command_type_createdAt_idx" ON "Command"("type", "createdAt");
CREATE INDEX "Activity_actorId_createdAt_idx" ON "Activity"("actorId", "createdAt");
CREATE INDEX "Activity_type_createdAt_idx" ON "Activity"("type", "createdAt");
