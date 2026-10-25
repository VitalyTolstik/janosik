-- CreateTable
CREATE TABLE "BoardShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'snapshot',
    "snapshot" JSONB,
    "snapshotVersion" INTEGER,
    "title" TEXT,
    "includeComments" BOOLEAN NOT NULL DEFAULT true,
    "includeAttachments" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardShare_token_key" ON "BoardShare"("token");

-- CreateIndex
CREATE INDEX "BoardShare_boardId_idx" ON "BoardShare"("boardId");

-- CreateIndex
CREATE INDEX "BoardShare_createdBy_idx" ON "BoardShare"("createdBy");

-- AddForeignKey
ALTER TABLE "BoardShare" ADD CONSTRAINT "BoardShare_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
