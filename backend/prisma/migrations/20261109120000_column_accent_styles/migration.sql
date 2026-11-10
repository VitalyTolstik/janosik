-- TASK-164: per-column accent (card-cover palette) and the board-wide shape.
-- Both nullable: absent means "no accent" / the default `signature` shape.
ALTER TABLE "Column" ADD COLUMN "accentType" TEXT,
                     ADD COLUMN "accentValue" TEXT;

ALTER TABLE "Board" ADD COLUMN "columnStyle" TEXT;
