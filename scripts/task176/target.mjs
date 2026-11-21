export const demoDatabaseName = "janosik_task176_demo";
export class DemoError extends Error {}

// Prisma loads backend/.env (and injects DATABASE_URL, JWT_SECRET and friends
// into process.env) at module import. Any entry point that imports a module
// which loads Prisma must capture this snapshot first, and only this snapshot
// may select the demo target, authorize a reset or supply reset secrets.
export const shellEnv = Object.freeze({ ...process.env });

function parseUrl(value, name) {
  try {
    return new URL(value);
  } catch {
    throw new DemoError(`Set ${name} to an explicit valid URL.`);
  }
}

const databaseOptions = new Set([
  "schema",
  "sslmode",
  "connect_timeout",
  "pool_timeout",
  "connection_limit",
]);

export function databaseTarget(value, isAllowed, name) {
  const url = parseUrl(value, name);
  const database = url.pathname.slice(1);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !url.hostname ||
    url.hash ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(database) ||
    !isAllowed(database)
  ) {
    throw new DemoError(
      `Refusing ${name}: use an explicitly allowed disposable database name.`,
    );
  }
  // Keep the path authoritative. Prisma/libpq options can redirect the host,
  // database or schema, and some options refer to other credential files.
  const keys = [...url.searchParams.keys()];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !databaseOptions.has(key)) ||
    (url.searchParams.has("schema") &&
      url.searchParams.get("schema") !== "public")
  ) {
    throw new DemoError(
      `Refusing ${name}: use the public schema and supported PostgreSQL URL options.`,
    );
  }
  return { database, databaseUrl: value, host: url.host };
}

export function apiTarget(value, name = "DEMO_API_URL") {
  const url = parseUrl(value, name);
  if (
    !/^http:\/\/127\.0\.0\.1:[0-9]+\/?$/.test(value) ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) < 1024
  ) {
    throw new DemoError(
      `Refusing ${name}: use http://127.0.0.1 with an explicit private port (1024–65535).`,
    );
  }
  return { apiUrl: url.origin, port: Number(url.port) };
}

export function assertEqualTargets(env) {
  for (const key of ["DATABASE_URL", "API_URL"]) {
    if (
      env[`DEMO_${key}`] !== undefined &&
      env[key] !== undefined &&
      env[`DEMO_${key}`] !== env[key]
    ) {
      throw new DemoError(`Conflicting ${key} and DEMO_${key}.`);
    }
  }
}

export function demoTarget(env, { api = false, reset = false } = {}) {
  if (env.NODE_ENV === "production")
    throw new DemoError("TASK-176 commands refuse NODE_ENV=production.");
  if (reset && env.SEED_ALLOW !== "1" && env.DEMO_RESET_ALLOW !== "1") {
    throw new DemoError(
      "Set DEMO_RESET_ALLOW=1 to authorize the disposable fixture reset.",
    );
  }
  if (api || reset) assertEqualTargets(env);
  const target = databaseTarget(
    env.DEMO_DATABASE_URL,
    (name) =>
      name === demoDatabaseName ||
      (env.DEMO_ALLOW_OTHER_DB === "1" && name.endsWith("_demo")),
    "DEMO_DATABASE_URL",
  );
  return api ? { ...target, ...apiTarget(env.DEMO_API_URL) } : target;
}

// Prisma and the backend receive only what they need. In particular, inherited
// engine overrides, test DSNs, dotenv flags, and Node loaders stay out.
export function childEnv(target) {
  const entries = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TERM", "NO_COLOR"];
  return {
    ...Object.fromEntries(
      entries
        .filter((key) => shellEnv[key] !== undefined)
        .map((key) => [key, shellEnv[key]]),
    ),
    DATABASE_URL: target.databaseUrl,
    ...(target.apiUrl ? { API_URL: target.apiUrl } : {}),
    NODE_ENV: "test",
  };
}

export function reportError(error, stage) {
  // Prisma, HTTP bodies, and child output can quote credentials or arbitrary
  // database content. Only our own diagnostics are safe to emit.
  console.error(
    error instanceof DemoError ? error.message : `${stage} failed.`,
  );
  process.exitCode = 1;
}
