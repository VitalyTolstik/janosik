-- Opt-in invitations (TASK-35 addendum): a BoardMember row is created as a
-- pending invitation (`acceptedAt IS NULL`) and confers no access until the
-- invitee accepts. Existing rows are memberships that were granted directly,
-- so they are backfilled as accepted.
ALTER TABLE "BoardMember" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "BoardMember" ADD COLUMN "invitedById" TEXT;

UPDATE "BoardMember" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;

CREATE INDEX "BoardMember_userId_acceptedAt_idx" ON "BoardMember"("userId", "acceptedAt");

ALTER TABLE "BoardMember"
  ADD CONSTRAINT "BoardMember_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
