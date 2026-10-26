-- TASK-71 background data exports.
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filename" TEXT NOT NULL,
    "storedName" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataExport_userId_idx" ON "DataExport"("userId");
