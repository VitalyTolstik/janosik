-- Two-tier master accounts (TASK-36): owners manage masters from the panel,
-- operators have full data access but no master-management rights.
ALTER TABLE "AdminUser" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;
