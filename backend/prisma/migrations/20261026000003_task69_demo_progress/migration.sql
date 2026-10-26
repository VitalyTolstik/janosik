-- TASK-69 demo run progress (cards that reached done), driven by the job.
ALTER TABLE "DemoRun" ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0;
