import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { bool, cleanEnv, makeValidator, num, port, str, url } from "envalid";

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

// Tests are hermetic: a developer machine's SMTP_* (backend/.env) must not
// turn e2e runs into live senders. Specs that exercise a transport start
// one explicitly via MailerService.reconfigure.
if (process.env.NODE_ENV === "test") {
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  process.env.SMTP_FROM = "";
}

// envalid 8 has no per-var validate option — a custom validator gives
// JWT_SECRET a clean fail-fast instead of a passport stack trace later.
const jwtSecret = makeValidator((v) => {
  if (v.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)",
    );
  }
  return v;
});

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
  JWT_SECRET: jwtSecret({
    desc: "Secret for signing JWT access tokens",
    example: "c15a6f2e9d84b0173ac6f8e5d21b4a0973e8c5d0f1a2b3c4d5e6f7a8b9c0d1e2",
  }),
  ACCESS_TOKEN_TTL: str({
    desc: "Access token lifetime, a vercel/ms duration string",
    default: "15m",
    example: "15m",
  }),
  REFRESH_TOKEN_TTL_DAYS: num({
    desc: "Refresh token lifetime in days",
    default: 30,
    example: "30",
  }),
  // Mail (TASK-51): every var is optional — without SMTP_HOST the mailer
  // logs outgoing emails to the server log instead of sending them, so
  // self-hosters get a working dev setup out of the box.
  SMTP_HOST: str({
    desc: "SMTP server host; unset = emails are logged, never sent",
    default: "",
    example: "smtp.gmail.com",
  }),
  SMTP_PORT: port({
    desc: "SMTP server port",
    default: 587,
    example: "587",
  }),
  SMTP_SECURE: bool({
    desc: "Use implicit TLS for SMTP (true for port 465)",
    default: false,
  }),
  SMTP_USER: str({ desc: "SMTP user (optional)", default: "" }),
  SMTP_PASS: str({ desc: "SMTP password (optional)", default: "" }),
  SMTP_FROM: str({
    desc: "From header for outgoing emails",
    default: "Janosik <no-reply@janosik.local>",
    example: "Janosik <no-reply@example.com>",
  }),
  // Master-panel mail settings (TASK-52): SMTP credentials saved from the
  // admin UI are encrypted at rest with this key. When unset the key is
  // derived from JWT_SECRET, so self-hosters need no extra configuration.
  SETTINGS_SECRET: str({
    desc: "Encryption key for credentials stored via the master panel; derived from JWT_SECRET when unset",
    default: "",
    example: "openssl rand -hex 32",
  }),
  // OAuth login (TASK-54): the canonical public base URL of the app (the
  // UI). Builds the provider callback URLs that must be registered in the
  // Google/Yandex consoles verbatim, and the post-login redirect target.
  PUBLIC_ORIGIN: url({
    desc: "Public base URL of the UI; OAuth callback URLs are derived from it",
    default: "http://localhost:5173",
    example: "https://kanban.example.com",
  }),
});
