-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "claimedBy" TEXT;
ALTER TABLE "Card" ADD COLUMN     "leaseUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Card_leaseUntil_idx" ON "Card"("leaseUntil");
