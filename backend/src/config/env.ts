import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { bool, cleanEnv, makeValidator, num, port, str, url } from "envalid";
import { SHARE_LIMITS } from "@janosik/shared";

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

// Tests are hermetic (see below); the global rate limit must not flake a
// thousand-request e2e suite either — specs that assert the limiter patch the
// guard or set their own @Throttle, so a huge default here is safe.
if (process.env.NODE_ENV === "test") {
  process.env.THROTTLE_LIMIT = "1000000";
}

// The public share contour has its own per-token budget; keep it small in
// tests so a burst spec can actually trip the 429 while the other share specs
// (a handful of requests per fresh token) stay well under it.
if (process.env.NODE_ENV === "test") {
  process.env.SHARE_RATE_LIMIT = "50";
  process.env.SHARE_OG_RATE_LIMIT = "50";
}

// Read caches (TASK-141) are off in tests, so a second read inside one spec
// always sees the freshly written database state.
if (process.env.NODE_ENV === "test") {
  process.env.SHARE_AGGREGATE_CACHE_MS = "0";
  process.env.ADMIN_METRICS_CACHE_MS = "0";
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

// Tests are hermetic here too: a developer machine's REDIS_URL (backend/.env)
// must not make the suite depend on a Redis container. Every queue drains
// in-process, exactly like a self-host without Redis (ROADMAP §7.11).
if (process.env.NODE_ENV === "test") {
  process.env.REDIS_URL = "";
  process.env.QUEUES_DASHBOARD = "false";
}

// Upload-rate limiting (TASK-146) stays effectively off in tests: the suite
// uploads many files with one account and a real 60/min budget would flake.
if (process.env.NODE_ENV === "test") {
  process.env.UPLOAD_RATE_LIMIT = "100000";
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

// TASK-156: the pool cap must be a whole, non-negative number (`0` means
// "leave Prisma's default alone").
const nonNegativeInt = makeValidator((v) => {
  const parsed = Number(v);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("must be a non-negative integer");
  }
  return parsed;
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
  // TASK-153 (B14): Prisma's default pool is sized from the CPU count (~33 on
  // a 16-vCPU node); with a few replicas that alone can exhaust
  // `max_connections=100`. Cap it explicitly unless the URL says otherwise.
  DB_CONNECTION_LIMIT: nonNegativeInt({
    desc: "Prisma pool size per process (0 = Prisma default)",
    default: 10,
    example: "10",
  }),
  // Queries at or above this duration are logged as warnings; 0 disables it.
  SLOW_QUERY_MS: num({
    desc: "Log Prisma queries slower than this (0 = off)",
    default: 200,
    example: "200",
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
  // Global API rate limit (requests per minute, per client). The default is a
  // sane self-host guard; the master panel can override it at runtime without
  // a restart, and demo runs raise it locally via this env var.
  THROTTLE_LIMIT: num({
    desc: "Global API rate limit in requests per minute, per client",
    default: 300,
    example: "300",
  }),
  // Reverse-proxy hops in front of the API (TASK-91). 0 (default) trusts no
  // proxy, so `req.ip` is the socket address. Behind one nginx set it to the
  // exact hop count: the throttler, the admin IP allowlist and the session
  // audit then key on the real client address instead of the proxy's.
  TRUST_PROXY: num({
    desc: "Number of trusted reverse-proxy hops; 0 = trust none",
    default: 0,
    example: "1",
  }),
  // Blob storage root (TASK-47/120). Empty = `backend/data/uploads`. A
  // relative value is anchored to the backend package, never the process cwd,
  // so a server launched from anywhere resolves the same files.
  UPLOAD_DIR: str({
    desc: "Directory for uploaded blobs; empty = backend/data/uploads",
    default: "",
    example: "/var/lib/janosik/uploads",
  }),
  // Built SPA directory (TASK-38b). When set, the API also serves the static
  // frontend and falls back to `index.html` for client-side routes, so one
  // container serves the whole app. Empty = API only (dev, e2e, nginx setups).
  STATIC_DIR: str({
    desc: "Directory with the built UI (index.html + assets); empty = API only",
    default: "",
    example: "/app/public",
  }),
  // Built marketing site + docs directory (TASK-123). Served at the site root
  // (`/`) while the app lives under `UI_BASE`; empty = site not served.
  SITE_DIR: str({
    desc: "Directory with the built marketing site (index.html + _astro); empty = not served",
    default: "",
    example: "/app/site",
  }),
  // Sub-path the app is served from (TASK-123): `/app/` when the marketing
  // site owns the root, `/` standalone. The built UI must use the same base
  // (Vite `UI_BASE`); this value drives the post-login/OAuth redirect target.
  UI_BASE: str({
    desc: "Sub-path the app is served from; used for OAuth redirects",
    default: "/",
    example: "/app/",
  }),
  // Public read-only board sharing (TASK-58, §7.9). On by default so a fresh
  // self-host can hand out a link; a private installation sets it to `false`
  // and the whole `/share/*` contour answers 404 (no share is readable).
  ALLOW_PUBLIC_SHARES: bool({
    desc: "Master switch for public read-only board share links",
    default: true,
  }),
  // Open sign-up (TASK-38a, §7.8). On by default so the very first run can
  // create its admin account; a public instance should set it to `false`
  // after that, otherwise anyone can register. Drives the `registration_open`
  // feature flag default and is surfaced to the UI via `GET /auth/config`.
  ALLOW_REGISTRATION: bool({
    desc: "Allow anyone to create an account; off = sign-up is refused",
    default: true,
  }),
  // Cookie `Secure` attribute (TASK-38a, §7.8). Empty = derived: `true` in
  // production, `false` elsewhere, so dev/e2e keep working over plain HTTP.
  // A production install served over HTTP must set this to `false`
  // explicitly — the API otherwise refuses to start rather than silently
  // drop the refresh cookie (see `assertBootSecurity`).
  COOKIE_SECURE: str({
    desc: "Force the Secure cookie attribute; empty = auto (on in production)",
    default: "",
    choices: ["", "true", "false"],
    example: "false",
  }),
  // Soft-delete purge window in days (TASK-38a, §7.8) — the fallback when the
  // master panel has no retention setting. The maintenance sweep deletes
  // entities soft-deleted longer ago than this.
  PURGE_AFTER_DAYS: num({
    desc: "Delete soft-deleted rows older than this many days (fallback)",
    default: 30,
    example: "30",
  }),
  // TASK-148: the master audit trail is trimmed on its own, longer window —
  // accountability wants history, not unbounded growth.
  AUDIT_RETENTION_DAYS: num({
    desc: "Delete admin audit-log rows older than this many days",
    default: 365,
    example: "365",
  }),
  // Per-token budget of the public share contour (requests/min). Keys by the
  // share token, not the IP, so one hammered link is bounded regardless of
  // how many readers hit it. The OG preview is heavier, hence a tighter one.
  SHARE_RATE_LIMIT: num({
    desc: "Public share requests per minute, per token",
    default: SHARE_LIMITS.rateLimitPerMinute,
    example: "240",
  }),
  SHARE_OG_RATE_LIMIT: num({
    desc: "Public share OG preview requests per minute, per token",
    default: SHARE_LIMITS.ogRateLimitPerMinute,
    example: "60",
  }),
  // Short-TTL read caches (TASK-141). A hot live-share link rebuilds its
  // aggregate at most once per window, and the board `seq` invalidates it the
  // moment a command commits; the master metrics snapshot is served from a
  // short cache too. 0 disables each cache.
  SHARE_AGGREGATE_CACHE_MS: num({
    desc: "Live-share aggregate cache window in ms (0 = disabled)",
    default: 2000,
    example: "2000",
  }),
  ADMIN_METRICS_CACHE_MS: num({
    desc: "Master /admin/metrics cache window in ms (0 = disabled)",
    default: 5000,
    example: "5000",
  }),
  // Live-stream admission caps (TASK-146): a ceiling on concurrent SSE
  // connections per instance, per user and per board. One VIEWER opening
  // thousands of streams is otherwise an unbounded memory draw. 0 = unlimited.
  SSE_MAX_CONNECTIONS: num({
    desc: "Max concurrent SSE connections per instance (0 = unlimited)",
    default: 5000,
    example: "5000",
  }),
  SSE_MAX_PER_USER: num({
    desc: "Max concurrent SSE connections per user (0 = unlimited)",
    default: 32,
    example: "32",
  }),
  SSE_MAX_PER_BOARD: num({
    desc: "Max concurrent SSE connections per board (0 = unlimited; a swarm may legitimately hold many)",
    default: 0,
    example: "0",
  }),
  // Attachment uploads per minute per user (TASK-146). 0 = unlimited.
  UPLOAD_RATE_LIMIT: num({
    desc: "Attachment uploads per minute per user (0 = unlimited)",
    default: 60,
    example: "60",
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
  // BullMQ job backend (TASK-62). When set (e.g. redis://localhost:6379) the
  // outgoing-mail broadcast runs through BullMQ on Redis; unset falls back to
  // the in-process queue, so a bare self-host needs no Redis.
  REDIS_URL: str({
    desc: "Redis connection URL for BullMQ queues; unset = in-process queue",
    default: "",
    example: "redis://localhost:6379",
  }),
  // Queue dashboard (TASK-73). Off by default: the Bull Board SPA is mounted
  // at /api/v1/admin/queues only when this is true (and Redis is configured).
  QUEUES_DASHBOARD: bool({
    desc: "Mount the Bull Board queue dashboard at /admin/queues (OWNER-only)",
    default: false,
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
