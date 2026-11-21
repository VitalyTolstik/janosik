-- TASK-181.7: measured indexes for the admin filter 25k qualification.
-- The MIME family is stored because an ILIKE prefix or a negated "other"
-- union cannot use an index; see docs/TASK-181.7-acceptance.md.
-- CREATE INDEX takes a write lock on the table while it builds. Schedule this
-- migration in a quiet window on larger installations; there is no backfill
-- beyond the one-time MIME family update below.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "mimeFamily" TEXT NOT NULL DEFAULT 'other';

-- Backfill the family from the stored MIME type. Keep this mapping in sync
-- with backend/src/attachments/mime-family.ts.
UPDATE "Attachment"
SET "mimeFamily" = CASE
  WHEN lower("mimeType") LIKE 'image/%' THEN 'image'
  WHEN lower("mimeType") LIKE 'video/%' THEN 'video'
  WHEN lower("mimeType") = 'application/pdf' THEN 'pdf'
  WHEN lower("mimeType") LIKE 'text/%'
    OR lower("mimeType") IN (
      'application/rtf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint'
    )
    OR lower("mimeType") LIKE 'application/vnd.openxmlformats-officedocument.%'
    THEN 'document'
  ELSE 'other'
END;

-- Rows written outside the upload service (fixtures, seeds, imports) still get
-- the right family. The application also sets the value explicitly on upload.
CREATE OR REPLACE FUNCTION "set_attachment_mime_family"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."mimeFamily" := CASE
    WHEN lower(NEW."mimeType") LIKE 'image/%' THEN 'image'
    WHEN lower(NEW."mimeType") LIKE 'video/%' THEN 'video'
    WHEN lower(NEW."mimeType") = 'application/pdf' THEN 'pdf'
    WHEN lower(NEW."mimeType") LIKE 'text/%'
      OR lower(NEW."mimeType") IN (
        'application/rtf',
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint'
      )
      OR lower(NEW."mimeType") LIKE 'application/vnd.openxmlformats-officedocument.%'
      THEN 'document'
    ELSE 'other'
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Attachment_mime_family_trigger"
BEFORE INSERT OR UPDATE OF "mimeType" ON "Attachment"
FOR EACH ROW EXECUTE FUNCTION "set_attachment_mime_family"();

-- CreateIndex
CREATE INDEX "Attachment_createdAt_idx" ON "Attachment"("createdAt");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_createdAt_idx" ON "Attachment"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_mimeFamily_createdAt_idx" ON "Attachment"("mimeFamily", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_transcodeStatus_createdAt_idx" ON "Attachment"("transcodeStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Card_columnId_deletedAt_idx" ON "Card"("columnId", "deletedAt");

-- CreateIndex
CREATE INDEX "Card_id_deletedAt_idx" ON "Card"("id", "deletedAt");

-- CreateIndex
CREATE INDEX "Card_createdAt_idx" ON "Card"("createdAt");

-- CreateIndex
CREATE INDEX "Card_priority_updatedAt_idx" ON "Card"("priority", "updatedAt");

-- CreateIndex
CREATE INDEX "Card_attachmentCount_updatedAt_idx" ON "Card"("attachmentCount", "updatedAt");

-- CreateIndex
CREATE INDEX "CardLabel_labelId_cardId_idx" ON "CardLabel"("labelId", "cardId");

-- CreateIndex
CREATE INDEX "CardLink_createdAt_idx" ON "CardLink"("createdAt");

-- CreateIndex
CREATE INDEX "CardLink_type_createdAt_idx" ON "CardLink"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CardLink_boardId_type_createdAt_idx" ON "CardLink"("boardId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_kind_createdAt_idx" ON "Comment"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_createdAt_idx" ON "Comment"("createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
