-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_revokedAt_idx" ON "RefreshToken"("familyId", "revokedAt");
