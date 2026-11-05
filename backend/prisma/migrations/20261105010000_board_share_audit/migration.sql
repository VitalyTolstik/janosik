CREATE TABLE "BoardShareAuditLog" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardShareAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoardShareAuditLog_boardId_createdAt_idx" ON "BoardShareAuditLog"("boardId", "createdAt");
CREATE INDEX "BoardShareAuditLog_shareId_createdAt_idx" ON "BoardShareAuditLog"("shareId", "createdAt");
