-- Optimistic concurrency for announcement edits (M2): two admins editing
-- different languages must not overwrite each other. The editor sends the
-- version it loaded; a stale PATCH is answered with 409.
ALTER TABLE "Announcement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- M12: the initial backfill marked every legacy `sendEmail = true` row as
-- sent, including drafts/rows that were never actually queued. Drafts never
-- sent a letter, so clear those; active legacy rows keep the protective
-- backfill because their delivery state is unknowable.
UPDATE "Announcement"
SET "emailSentAt" = NULL
WHERE "active" = false;
