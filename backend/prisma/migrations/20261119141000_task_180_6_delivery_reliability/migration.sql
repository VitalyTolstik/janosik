ALTER TABLE "NotificationMail" ADD COLUMN "failedAt" TIMESTAMP(3);

-- Older broadcasts did not distinguish known accounts from external addresses.
UPDATE "NotificationMail" AS mail
SET "userId" = recipient.id
FROM "User" AS recipient
WHERE mail.kind = 'broadcast'
  AND mail."finishedAt" IS NULL
  AND mail."userId" IS NULL
  AND lower(mail.message->>'to') = lower(recipient.email);

-- An unmatched legacy address may belong to a deleted account. The old
-- payload cannot distinguish that case from an external segment address.
UPDATE "NotificationMail"
SET "finishedAt" = CURRENT_TIMESTAMP,
    "failedAt" = CURRENT_TIMESTAMP,
    message = NULL
WHERE kind = 'broadcast'
  AND "finishedAt" IS NULL
  AND "userId" IS NULL;

DROP INDEX "NotificationMail_finishedAt_nextAttemptAt_idx";
CREATE INDEX "NotificationMail_finishedAt_nextAttemptAt_id_idx"
  ON "NotificationMail"("finishedAt", "nextAttemptAt", id);
