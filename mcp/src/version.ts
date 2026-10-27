import { readFileSync } from "node:fs";

/**
 * The package version, read from `package.json` (which ships next to the
 * bundle) so the value advertised over MCP never drifts from the published
 * package.
 */
export function readVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
