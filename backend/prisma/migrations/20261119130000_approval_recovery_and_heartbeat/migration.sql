ALTER TABLE "AgentSession" ADD COLUMN "lastHeartbeatPublishedAt" TIMESTAMP(3);

UPDATE "ApprovalRequest" AS approval
SET status = 'cancelled', "decidedAt" = session."endedAt"
FROM "AgentSession" AS session
WHERE approval."agentSessionId" = session.id
  AND approval."boardId" = session."boardId"
  AND session."endedAt" IS NOT NULL
  AND approval.status IN ('pending', 'approved')
  AND approval."expiresAt" > CURRENT_TIMESTAMP;
