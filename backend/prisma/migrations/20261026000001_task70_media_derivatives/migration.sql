-- TASK-70 media derivatives: thumbnail (images) / poster (videos) blobs.
ALTER TABLE "Attachment" ADD COLUMN     "thumbnailName" TEXT;
ALTER TABLE "Attachment" ADD COLUMN     "posterName" TEXT;
ALTER TABLE "Attachment" ADD COLUMN     "derivativeStatus" TEXT NOT NULL DEFAULT 'none';
