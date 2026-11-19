CREATE TABLE "BoardShareSnapshotBlob" (
    "storedName" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,

    CONSTRAINT "BoardShareSnapshotBlob_pkey" PRIMARY KEY ("storedName")
);

CREATE INDEX "BoardShareSnapshotBlob_shareId_idx" ON "BoardShareSnapshotBlob"("shareId");

ALTER TABLE "BoardShareSnapshotBlob" ADD CONSTRAINT "BoardShareSnapshotBlob_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "BoardShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AgentSession_endedAt_idx" ON "AgentSession"("endedAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_decidedAt_idx" ON "ApprovalRequest"("status", "decidedAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_consumedAt_idx" ON "ApprovalRequest"("status", "consumedAt");
