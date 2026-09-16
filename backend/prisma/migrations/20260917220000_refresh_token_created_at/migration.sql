-- Session review in the master panel (TASK-43): the panel lists active
-- sessions with their age, so the row needs its creation timestamp.
ALTER TABLE "RefreshToken" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "RefreshToken_userId_createdAt_idx" ON "RefreshToken"("userId", "createdAt");
