-- Explicit master tier enum (TASK-36): replaces the boolean shortcut with a
-- named role, mirroring `BoardMember.role` so the whole access model is
-- visible in the schema.
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'OPERATOR');

ALTER TABLE "AdminUser" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'OPERATOR';

UPDATE "AdminUser" SET "role" = 'OWNER' WHERE "isOwner" = true;

ALTER TABLE "AdminUser" DROP COLUMN "isOwner";
