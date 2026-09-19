-- CreateTable
CREATE TABLE "CardLink" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromCardId" TEXT NOT NULL,
    "toCardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardLink_boardId_idx" ON "CardLink"("boardId");

-- CreateIndex
CREATE INDEX "CardLink_fromCardId_position_idx" ON "CardLink"("fromCardId", "position");

-- CreateIndex
CREATE INDEX "CardLink_toCardId_idx" ON "CardLink"("toCardId");

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_fromCardId_fkey" FOREIGN KEY ("fromCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_toCardId_fkey" FOREIGN KEY ("toCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
