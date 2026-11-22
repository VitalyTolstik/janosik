-- TASK-185.1: immutable comment edit history, cutover fence and GDPR markers.
--
-- Existing rows share one database timestamp as the fence. `editedAt` is
-- copied into the verified pair with no revision number, and a pre-release
-- edit is marked `legacy_cutover`; no revisions are synthesised. New rows get
-- the fence from the database default when they are inserted.

-- CreateEnum
CREATE TYPE "CommentHistoryIncompleteReason" AS ENUM ('legacy_cutover', 'revision_limit', 'gdpr_erase', 'writer_gap');

-- CreateEnum
CREATE TYPE "CommentRevisionCause" AS ENUM ('author_edit', 'attachment_deleted', 'system');

-- AlterTable (the fence is added empty first so the backfill can use one
-- transaction timestamp for every existing row)
ALTER TABLE "Comment" ADD COLUMN     "historyCutoverAt" TIMESTAMP(3),
ADD COLUMN     "historyIncompleteReason" "CommentHistoryIncompleteReason",
ADD COLUMN     "historyVerifiedEditedAt" TIMESTAMP(3),
ADD COLUMN     "historyVerifiedRevisionNumber" INTEGER,
ADD COLUMN     "lastRevisionNumber" INTEGER NOT NULL DEFAULT 0;

-- Backfill: one cutover timestamp for the whole table, the last known text
-- state as the verified point, and `legacy_cutover` for a pre-release edit.
UPDATE "Comment"
SET "historyCutoverAt" = CURRENT_TIMESTAMP,
    "historyVerifiedEditedAt" = "editedAt",
    "historyIncompleteReason" = CASE
      WHEN "editedAt" IS NOT NULL
        THEN 'legacy_cutover'::"CommentHistoryIncompleteReason"
      ELSE NULL
    END;

ALTER TABLE "Comment" ALTER COLUMN "historyCutoverAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Comment" ALTER COLUMN "historyCutoverAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "CommentRevision" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "beforeText" TEXT NOT NULL,
    "afterText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'human',
    "apiTokenId" TEXT,
    "agentSessionId" TEXT,
    "agentName" TEXT,
    "cause" "CommentRevisionCause" NOT NULL,

    CONSTRAINT "CommentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentRevision_editorId_idx" ON "CommentRevision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentRevision_commentId_revisionNumber_key" ON "CommentRevision"("commentId", "revisionNumber");

-- AddForeignKey: both parents RESTRICT physical deletes; purge and erase
-- delete revision rows explicitly before the comment or user row.
ALTER TABLE "CommentRevision" ADD CONSTRAINT "CommentRevision_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentRevision" ADD CONSTRAINT "CommentRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
