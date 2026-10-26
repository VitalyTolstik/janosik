-- CreateTable
CREATE TABLE "ReminderSent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderSent_sentAt_idx" ON "ReminderSent"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSent_cardId_userId_dueDate_key" ON "ReminderSent"("cardId", "userId", "dueDate");
