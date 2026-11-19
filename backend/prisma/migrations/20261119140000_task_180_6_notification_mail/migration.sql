CREATE TYPE "NotificationMailKind" AS ENUM ('broadcast', 'attention', 'digest', 'reminder');

CREATE TABLE "NotificationMail" (
    "id" TEXT NOT NULL,
    "kind" "NotificationMailKind" NOT NULL,
    "message" JSONB,
    "userId" TEXT,
    "boardIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationMail_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AttentionNotification"
    ADD COLUMN "attentionMailId" TEXT,
    ADD COLUMN "digestMailId" TEXT;

CREATE UNIQUE INDEX "AttentionNotification_attentionMailId_key" ON "AttentionNotification"("attentionMailId");
CREATE INDEX "AttentionNotification_digestMailId_idx" ON "AttentionNotification"("digestMailId");
CREATE INDEX "NotificationMail_finishedAt_nextAttemptAt_idx" ON "NotificationMail"("finishedAt", "nextAttemptAt");
CREATE INDEX "NotificationMail_userId_idx" ON "NotificationMail"("userId");
