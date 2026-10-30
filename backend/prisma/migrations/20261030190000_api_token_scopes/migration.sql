-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "boardId" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN     "readOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ApiToken" ADD COLUMN     "rateLimitPerMinute" INTEGER;
