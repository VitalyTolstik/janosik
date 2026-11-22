import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The latest released version in the root `CHANGELOG.md` (TASK-185.4).
 *
 * The card's legacy-cutover banner names the release that introduced edit
 * history. `package.json` and the changelog move together at release time;
 * reading the changelog keeps the banner tied to the written release notes
 * instead of whichever workspace version happens to be installed.
 */
export function changelogRelease(): string {
  try {
    const changelog = readFileSync(
      path.resolve(import.meta.dirname, "../../CHANGELOG.md"),
      "utf8",
    );
    const match = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog);
    if (match !== null) return match[1];
  } catch {
    /* fall through to the build-time fallback */
  }
  return "0.0.0";
}
