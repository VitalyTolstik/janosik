import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { cleanEnv, port, str, url } from "envalid";

/**
 * Backend config — the single place where process.env is read and validated.
 *
 * Layered env loading (later files override earlier ones):
 *   .env  →  .env.${NODE_ENV}  →  .env.local
 * (a dotenv-based equivalent of custom-env, but typed and without extra deps)
 *
 * envalid fails fast at boot if a var is missing or malformed — instead of
 * surfacing later as a runtime connection error.
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
    desc: "Runtime environment; jest sets this to 'test' automatically",
    choices: ["development", "test", "production"],
    default: "development",
  }),
  PORT: port({
    desc: "HTTP port the API listens on",
    default: 3000,
    example: "3000",
  }),
  DATABASE_URL: url({
    desc: "PostgreSQL connection string used by Prisma",
    example: "postgresql://user:password@localhost:5433/janosik",
  }),
  TEST_DATABASE_URL: str({
    desc: "PostgreSQL connection string for e2e runs; when set, test runs use it instead of DATABASE_URL",
    default: "",
    example: "postgresql://user:password@localhost:5433/janosik_test",
  }),
});
