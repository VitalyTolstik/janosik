-- TASK-156: let a snapshot share outlive its source board.
--
-- Purging or deleting a board used to delete every BoardShare row, even
-- though `mode = 'snapshot'` carries a frozen envelope and promises to keep
-- serving. The board relation becomes optional and detaches on delete; the
-- purge job only removes live shares.

-- DropForeignKey
ALTER TABLE "BoardShare" DROP CONSTRAINT IF EXISTS "BoardShare_boardId_fkey";

-- AlterTable
ALTER TABLE "BoardShare" ALTER COLUMN "boardId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BoardShare"
  ADD CONSTRAINT "BoardShare_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;