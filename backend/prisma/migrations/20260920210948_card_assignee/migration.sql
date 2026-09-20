-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "assigneeId" TEXT;

-- CreateIndex
CREATE INDEX "Card_assigneeId_idx" ON "Card"("assigneeId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
