CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'rose',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Card" ADD COLUMN "epicId" TEXT;

CREATE INDEX "Epic_boardId_deletedAt_status_position_idx" ON "Epic"("boardId", "deletedAt", "status", "position");
CREATE INDEX "Epic_boardId_status_idx" ON "Epic"("boardId", "status");
CREATE INDEX "Epic_ownerId_idx" ON "Epic"("ownerId");
CREATE INDEX "Epic_dueDate_idx" ON "Epic"("dueDate");
CREATE INDEX "Card_epicId_idx" ON "Card"("epicId");

ALTER TABLE "Epic" ADD CONSTRAINT "Epic_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER "Epic_bump_board_revision_insert"
AFTER INSERT ON "Epic"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_insert();

CREATE TRIGGER "Epic_bump_board_revision_update"
AFTER UPDATE ON "Epic"
REFERENCING OLD TABLE AS old_changed_rows NEW TABLE AS new_changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_update();

CREATE TRIGGER "Epic_bump_board_revision_delete"
AFTER DELETE ON "Epic"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION janosik_bump_boards_direct_delete();
