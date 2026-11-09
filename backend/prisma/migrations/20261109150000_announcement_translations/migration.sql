-- Announcement localization: one logical announcement with per-locale
-- translations, an explicit fallback policy and a canonical user locale.
--
-- Legacy rows keep their `title`/`body`, stay `sourceLocale = NULL` (unknown
-- language) and are switched to `allow_fallback` so they keep working exactly
-- as before the migration. New rows store content only in
-- `AnnouncementTranslation`.

ALTER TABLE "Announcement" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "Announcement" ALTER COLUMN "body" DROP NOT NULL;

ALTER TABLE "Announcement"
  ADD COLUMN "sourceLocale" TEXT,
  ADD COLUMN "fallbackPolicy" TEXT NOT NULL DEFAULT 'require_all',
  ADD COLUMN "emailSentAt" TIMESTAMP(3);

-- Existing announcements predate the policy: never block their publication.
UPDATE "Announcement"
SET "fallbackPolicy" = 'allow_fallback'
WHERE "sourceLocale" IS NULL;

-- Backfill delivery state so a future resend cannot duplicate a legacy letter.
-- Drafts never sent anything and stay eligible for their first publication.
UPDATE "Announcement"
SET "emailSentAt" = "updatedAt"
WHERE "sendEmail" = true AND "active" = true AND "emailSentAt" IS NULL;

CREATE TABLE "AnnouncementTranslation" (
  "id"              TEXT NOT NULL,
  "announcementId"  TEXT NOT NULL,
  "locale"          TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "origin"          TEXT NOT NULL DEFAULT 'human',
  "translatedFrom"  TEXT,
  "sourceUpdatedAt" TIMESTAMP(3),
  "reviewedAt"      TIMESTAMP(3),
  "updatedBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnnouncementTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementTranslation_announcementId_locale_key"
  ON "AnnouncementTranslation"("announcementId", "locale");
CREATE INDEX "AnnouncementTranslation_locale_idx"
  ON "AnnouncementTranslation"("locale");

ALTER TABLE "AnnouncementTranslation"
  ADD CONSTRAINT "AnnouncementTranslation_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Announcement_active_startsAt_endsAt_idx"
  ON "Announcement"("active", "startsAt", "endsAt");

-- Canonical language for the UI, announcements and email. NULL means the
-- account predates localization; the client adopts the current UI language on
-- the next sign-in. Email falls back to English for NULL.
ALTER TABLE "User" ADD COLUMN "locale" TEXT;
