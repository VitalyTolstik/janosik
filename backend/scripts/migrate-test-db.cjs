// Runs `prisma migrate deploy` against the e2e test database
// (TEST_DATABASE_URL from backend/.env), not the dev one.
require("dotenv").config();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

require("child_process").execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  cwd: `${__dirname}/..`,
});
