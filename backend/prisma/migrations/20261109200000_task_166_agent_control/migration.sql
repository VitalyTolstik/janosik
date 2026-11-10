-- TASK-166.1: agent identity, sessions and the full agent-control schema.
-- Schema owner: stream 166.1 (ADR §6, §14.2). Every field is nullable or has
-- a safe default; no existing column is renamed or removed.
--
-- ApiToken grandfathering (§6.13):
--   1. add scopePreset nullable (the worker default must not touch old rows);
--   2. old tokens become `admin`;
--   3. trustedCi defaults to false, then every read/write legacy token gets
--      true (read-only tokens keep the flag but remain effective observers);
--   4. scopePreset becomes NOT NULL DEFAULT 'worker' for new tokens.

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "scopePreset" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN     "trustedCi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ApiToken" ADD COLUMN     "individualPausedAt" TIMESTAMP(3),
ADD COLUMN     "individualPausedBy" TEXT,
ADD COLUMN     "individualPausedReason" TEXT,
ADD COLUMN     "stopAllPausedAt" TIMESTAMP(3),
ADD COLUMN     "stopAllPausedBy" TEXT;

UPDATE "ApiToken" SET "scopePreset" = 'admin' WHERE "scopePreset" IS NULL;
UPDATE "ApiToken" SET "trustedCi" = true WHERE "readOnly" = false;

ALTER TABLE "ApiToken" ALTER COLUMN "scopePreset" SET DEFAULT 'worker';
ALTER TABLE "ApiToken" ALTER COLUMN "scopePreset" SET NOT NULL;

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "apiTokenId" TEXT,
ADD COLUMN     "runId" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "uploadedBySessionId" TEXT,
ADD COLUMN     "uploadedByTokenId" TEXT;

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "agentPolicy" JSONB,
ADD COLUMN     "agentPolicyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "agentsPauseReason" TEXT,
ADD COLUMN     "agentsPausedAt" TIMESTAMP(3),
ADD COLUMN     "agentsPausedBy" TEXT;

-- AlterTable
ALTER TABLE "BoardShareAuditLog" ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "apiTokenId" TEXT;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "claimedBySessionId" TEXT,
ADD COLUMN     "claimedByTokenId" TEXT;

-- AlterTable
ALTER TABLE "Command" ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "apiTokenId" TEXT,
ADD COLUMN     "runId" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "actorType" TEXT NOT NULL DEFAULT 'human',
ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "apiTokenId" TEXT;

-- CreateTable
CREATE TABLE "CommandPreimage" (
    "commandId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "runId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandPreimage_pkey" PRIMARY KEY ("commandId")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" VARCHAR(100),
    "clientName" VARCHAR(100),
    "model" VARCHAR(100),
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentCardId" TEXT,
    "currentRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pausedBy" TEXT,
    "pausedReason" TEXT,
    "summary" TEXT,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "apiTokenId" TEXT,
    "agentSessionId" TEXT,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "clientRunId" TEXT,
    "planHash" TEXT,
    "approvalId" TEXT,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeq" BIGINT,
    "lastSeq" BIGINT,
    "revertsRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "cardId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedByTokenId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "kind" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "plan" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "runId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'human',
    "apiTokenId" TEXT,
    "agentSessionId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandPreimage_boardId_runId_idx" ON "CommandPreimage"("boardId", "runId");

-- CreateIndex
CREATE INDEX "CommandPreimage_createdAt_idx" ON "CommandPreimage"("createdAt");

-- CreateIndex
CREATE INDEX "AgentSession_apiTokenId_status_idx" ON "AgentSession"("apiTokenId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_boardId_status_lastHeartbeatAt_idx" ON "AgentSession"("boardId", "status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "AgentSession_boardId_startedAt_idx" ON "AgentSession"("boardId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_userId_startedAt_idx" ON "AgentSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_lastHeartbeatAt_idx" ON "AgentSession"("lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_approvalId_key" ON "AgentRun"("approvalId");

-- CreateIndex
CREATE INDEX "AgentRun_boardId_createdAt_idx" ON "AgentRun"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentSessionId_createdAt_idx" ON "AgentRun"("agentSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_apiTokenId_createdAt_idx" ON "AgentRun"("apiTokenId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_boardId_clientRunId_key" ON "AgentRun"("boardId", "clientRunId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_boardId_status_createdAt_idx" ON "ApprovalRequest"("boardId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedByTokenId_status_idx" ON "ApprovalRequest"("requestedByTokenId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_expiresAt_status_idx" ON "ApprovalRequest"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_planHash_idx" ON "ApprovalRequest"("planHash");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_userId_createdAt_idx" ON "SecurityAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_action_createdAt_idx" ON "SecurityAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_targetType_targetId_idx" ON "SecurityAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "SecurityAuditLog_createdAt_idx" ON "SecurityAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_actorKey_key_key" ON "IdempotencyRecord"("scope", "actorKey", "key");

-- CreateIndex
CREATE INDEX "Activity_apiTokenId_createdAt_idx" ON "Activity"("apiTokenId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_agentSessionId_createdAt_idx" ON "Activity"("agentSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_runId_idx" ON "Activity"("runId");

-- CreateIndex
CREATE INDEX "ApiToken_userId_individualPausedAt_idx" ON "ApiToken"("userId", "individualPausedAt");

-- CreateIndex
CREATE INDEX "ApiToken_userId_stopAllPausedAt_idx" ON "ApiToken"("userId", "stopAllPausedAt");

-- CreateIndex
CREATE INDEX "Attachment_uploadedByTokenId_idx" ON "Attachment"("uploadedByTokenId");

-- CreateIndex
CREATE INDEX "Attachment_uploadedBySessionId_idx" ON "Attachment"("uploadedBySessionId");

-- CreateIndex
CREATE INDEX "Card_claimedByTokenId_idx" ON "Card"("claimedByTokenId");

-- CreateIndex
CREATE INDEX "Card_claimedBySessionId_idx" ON "Card"("claimedBySessionId");

-- CreateIndex
CREATE INDEX "Command_apiTokenId_createdAt_idx" ON "Command"("apiTokenId", "createdAt");

-- CreateIndex
CREATE INDEX "Command_agentSessionId_createdAt_idx" ON "Command"("agentSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Command_runId_idx" ON "Command"("runId");

-- CreateIndex
CREATE INDEX "Comment_apiTokenId_createdAt_idx" ON "Comment"("apiTokenId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_agentSessionId_createdAt_idx" ON "Comment"("agentSessionId", "createdAt");
