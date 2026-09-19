-- TASK-45: Jira-style card priority. `NULL` means the default "medium" —
-- the field is only stored when a card deviates from the default, matching
-- the optional-field convention of the board aggregate.
ALTER TABLE "Card" ADD COLUMN "priority" TEXT;
