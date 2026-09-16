-- Label order on the board (TASK-27): `GET /boards/:id` returns labels in
-- `position` order, matching the reducer's ordered `board.labels` array.
ALTER TABLE "Label" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "Label_boardId_idx";

CREATE INDEX "Label_boardId_position_idx" ON "Label"("boardId", "position");
