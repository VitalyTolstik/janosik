-- AlterTable
ALTER TABLE "Command" ADD COLUMN     "actorType" TEXT NOT NULL DEFAULT 'human';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "actorType" TEXT NOT NULL DEFAULT 'human';
