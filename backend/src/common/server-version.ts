import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Backend package version for the identity/whoami surface (TASK-166).
 *
 * The JSON ships next to `src`/`dist`, so `../../package.json` resolves to
 * `backend/package.json` both under ts-jest and in the compiled image.
 */
function readServerVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "../../package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SERVER_VERSION = readServerVersion();

/** Public API major version advertised to agents. */
export const API_VERSION = "1";
