-- TASK-23: minimal User table (full §7.3 schema arrives with TASK-24/25).
CREATE TABLE "User" (
    "id"           TEXT        NOT NULL,
    "email"        TEXT        NOT NULL,
    "passwordHash" TEXT        NOT NULL,
    "displayName"  TEXT,
    "isSuperAdmin" BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
