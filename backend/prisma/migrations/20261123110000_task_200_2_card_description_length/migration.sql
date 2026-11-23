-- TASK-200.2: ready summaries expose the stored description length without
-- reading the description text. A generated column cannot be added as a
-- Prisma field portably, so keep a plain column in sync with a trigger on
-- every INSERT and every description UPDATE. Prisma create/update/import and
-- raw SQL all go through the same trigger.

ALTER TABLE "Card" ADD COLUMN "descriptionLength" INTEGER NOT NULL DEFAULT 0;

UPDATE "Card"
SET "descriptionLength" = COALESCE(char_length("description"), 0);

CREATE OR REPLACE FUNCTION set_card_description_length()
RETURNS trigger AS $$
BEGIN
  NEW."descriptionLength" := COALESCE(char_length(NEW."description"), 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Card_description_length_trigger"
  BEFORE INSERT OR UPDATE OF "description" ON "Card"
  FOR EACH ROW
  EXECUTE FUNCTION set_card_description_length();
