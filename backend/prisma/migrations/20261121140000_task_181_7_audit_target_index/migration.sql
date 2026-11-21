-- TASK-181.7: the 25k audit target-type + period filter. The existing
-- (targetType, targetId) index cannot order or bound the period.
CREATE INDEX "AdminAuditLog_targetType_createdAt_idx"
  ON "AdminAuditLog"("targetType", "createdAt");
