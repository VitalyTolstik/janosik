import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { cleanEnv, port, str, url } from "envalid";

/**
 * Layered env loading — later files override earlier ones:
 *   .env  →  .env.${NODE_ENV}  →  .env.local
 * Then everything is validated by envalid: a missing/broken var fails fast
 * at boot instead of surfacing as a runtime connection error.
 *
 * In test runs (jest sets NODE_ENV=test) DATABASE_URL is switched to
 * TEST_DATABASE_URL, so e2e never touches the dev database.
 */

const load = (file: string): void => {
  // Resolve from the package root: src/config (ts-jest) and dist/config
  // (compiled) are both two levels below it.
  const full = path.resolve(__dirname, "..", "..", file);
  if (fs.existsSync(full)) {
    dotenv.config({ path: full, override: true });
  }
};

load(".env");
load(`.env.${process.env.NODE_ENV ?? "development"}`);
load(".env.local");

if (process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production"],
    default: "development",
  }),
  PORT: port({ default: 3000 }),
  DATABASE_URL: url(),
  TEST_DATABASE_URL: str({ default: "" }),
});
