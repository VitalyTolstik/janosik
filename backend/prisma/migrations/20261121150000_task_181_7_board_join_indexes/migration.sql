-- TASK-181.7: board-scoped comments join Column -> Card -> Comment. These
-- covering indexes let the join carry only ids, so the 25k page picks the
-- Column -> Card -> Comment nested loop instead of scanning Comment in
-- createdAt order.
--
-- CREATE INDEX takes a write lock on the two small dimension tables while it
-- builds; schedule it with the other TASK-181.7 index migrations.
CREATE INDEX "Column_boardId_id_idx" ON "Column"("boardId", id);
CREATE INDEX "Card_columnId_id_idx" ON "Card"("columnId", id);
