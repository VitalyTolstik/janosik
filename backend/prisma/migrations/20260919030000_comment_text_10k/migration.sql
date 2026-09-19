-- Comments widened to the new LIMITS.comment (10000): the column type was
-- the only hard 2000 bound (the app validated against LIMITS.comment).
ALTER TABLE "Comment" ALTER COLUMN "text" TYPE TEXT;
