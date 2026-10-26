-- TASK-72 scheduled comms: digest/reminder cadence + user opt-out.
ALTER TABLE "User" ADD COLUMN     "notifyDigest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OpsSettings" ADD COLUMN     "digestIntervalHours" INTEGER;
ALTER TABLE "OpsSettings" ADD COLUMN     "reminderLeadHours" INTEGER;
