-- TASK-53 backfill: every account that existed before registration
-- verification is trusted (they were created when no confirmation existed).
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
