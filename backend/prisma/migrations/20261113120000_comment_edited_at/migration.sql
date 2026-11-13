-- TASK-176.2: author-only comment editing.
-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "editedAt" TIMESTAMP(3);
