-- TASK-24: refresh tokens for session rotation + reuse detection (§7.3).
-- Tokens are stored as sha256 hashes only (tokenHash, unique); the raw
-- opaque token never touches the database.
CREATE TABLE "RefreshToken" (
    "id"        TEXT        NOT NULL,
    "tokenHash" TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
