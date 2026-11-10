-- Admin-configurable card workflow. NULL means no process and keeps the
-- legacy "all moves allowed" behaviour; existing boards need no backfill.
ALTER TABLE "Board" ADD COLUMN "workflow" JSONB;
