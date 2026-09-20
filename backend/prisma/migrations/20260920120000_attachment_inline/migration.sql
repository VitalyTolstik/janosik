-- Inline pasted media (TASK-48): attachments embedded into a description or
-- comment body instead of the attachment list.
ALTER TABLE "Attachment" ADD COLUMN "isInline" BOOLEAN NOT NULL DEFAULT false;
