-- TASK-166.9: attention inbox, e-mail opt-out and digest v2 bookkeeping.
-- Additive only: the new preference defaults to on, so existing accounts keep
-- receiving the same scheduled mail and gain the new attention letters until
-- they explicitly opt out.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyAttention" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AttentionNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT,
    "type" TEXT NOT NULL,
    "dedupKey" VARCHAR(300) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "digestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttentionNotification_dedupKey_key" ON "AttentionNotification"("dedupKey");

-- CreateIndex
CREATE INDEX "AttentionNotification_userId_createdAt_idx" ON "AttentionNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionNotification_userId_readAt_idx" ON "AttentionNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AttentionNotification_userId_digestedAt_idx" ON "AttentionNotification"("userId", "digestedAt");

-- CreateIndex
CREATE INDEX "AttentionNotification_boardId_createdAt_idx" ON "AttentionNotification"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionNotification_createdAt_idx" ON "AttentionNotification"("createdAt");
