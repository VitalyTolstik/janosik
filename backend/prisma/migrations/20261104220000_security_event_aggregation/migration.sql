ALTER TABLE "AdminAuditLog" ADD COLUMN "aggregateKey" TEXT,
ADD COLUMN "eventCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "AdminAuditLog" SET "lastOccurredAt" = "createdAt";
CREATE UNIQUE INDEX "AdminAuditLog_aggregateKey_key" ON "AdminAuditLog"("aggregateKey");
