import { readFileSync } from "node:fs";

/**
 * The product version the documentation describes. Read from the repo root
 * `package.json` at build time, so a release bump moves the docs badge with
 * it and there is a single source of truth for the number.
 *
 * Docs are versioned per major release: the docs under `/docs/` always
 * describe the latest version, and a version switcher is added only once a
 * second supported major exists. Until then this is the only version.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The version shown in the docs header, e.g. `0.1.0`. */
export const docsVersion = readVersion();
