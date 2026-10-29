// TASK-148 (B8) — build the retention indexes on a live instance without
// blocking writes.
//
// `prisma migrate deploy` runs each migration inside a transaction, where
// `CREATE INDEX CONCURRENTLY` is illegal. The migration
// (`20261029180000_task148_retention_indexes`) therefore creates the indexes
// inline, which is fine on a fresh install. On an existing instance with a
// large `Command`/`Activity`/`Card` tree, run this script *first*:
//
//   npm run db:indexes --workspace backend
//
// Prisma's `$executeRawUnsafe` runs each statement in autocommit, so the
// CONCURRENTLY build takes only a brief lock. The following migration then
// sees `IF NOT EXISTS` satisfied and is a no-op.
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const STATEMENTS = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Board_deletedAt_idx" ON "Board"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Column_deletedAt_idx" ON "Column"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Card_deletedAt_idx" ON "Card"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "CardLink_deletedAt_idx" ON "CardLink"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Label_deletedAt_idx" ON "Label"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Checklist_deletedAt_idx" ON "Checklist"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChecklistItem_deletedAt_idx" ON "ChecklistItem"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_deletedAt_idx" ON "Comment"("deletedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminRefreshToken_expiresAt_idx" ON "AdminRefreshToken"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminRefreshToken_revokedAt_idx" ON "AdminRefreshToken"("revokedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "BoardShare_expiresAt_idx" ON "BoardShare"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "BoardShare_revokedAt_idx" ON "BoardShare"("revokedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "BoardMember_expiresAt_idx" ON "BoardMember"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Activity_createdAt_idx" ON "Activity"("createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReminderSent_dueDate_idx" ON "ReminderSent"("dueDate")`,
  // TASK-156: the code sweeps filtered an unindexed column pair.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailVerificationCode_expiresAt_idx" ON "EmailVerificationCode"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailVerificationCode_consumedAt_idx" ON "EmailVerificationCode"("consumedAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailChangeCode_expiresAt_idx" ON "EmailChangeCode"("expiresAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailChangeCode_consumedAt_idx" ON "EmailChangeCode"("consumedAt")`,
];

(async () => {
  const prisma = new PrismaClient();
  try {
    for (const sql of STATEMENTS) {
      const name = sql.match(/"(\w+)" ON/)[1];
      const started = Date.now();
      // An interrupted CONCURRENTLY build leaves the index present but
      // `indisvalid = false`; `IF NOT EXISTS` would keep it forever
      // (TASK-156). Drop that husk and rebuild.
      const existing = await prisma.$queryRawUnsafe(
        `SELECT i.indisvalid AS valid
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = $1`,
        name,
      );
      if (existing.length > 0 && existing[0].valid === false) {
        console.log(`drop invalid ${name}`);
        await prisma.$executeRawUnsafe(
          `DROP INDEX CONCURRENTLY IF EXISTS "${name}"`,
        );
      }
      await prisma.$executeRawUnsafe(sql);
      console.log(`ok ${name} (${Date.now() - started} ms)`);
    }
    console.log("retention indexes ready");
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(`db:indexes failed: ${error.message}`);
  process.exit(1);
});
