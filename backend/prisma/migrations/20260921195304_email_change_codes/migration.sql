-- CreateTable
CREATE TABLE "EmailChangeCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeCode_codeHash_key" ON "EmailChangeCode"("codeHash");

-- CreateIndex
CREATE INDEX "EmailChangeCode_userId_idx" ON "EmailChangeCode"("userId");

-- AddForeignKey
ALTER TABLE "EmailChangeCode" ADD CONSTRAINT "EmailChangeCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
