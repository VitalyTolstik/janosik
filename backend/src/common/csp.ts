import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Upper bound on HTML files scanned per directory (a docs site is ~50). */
const MAX_HTML_FILES = 5_000;

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * CSP `'sha256-…'` sources for every inline `<script>` in the built
 * frontends this process serves (review "minor": no `'unsafe-inline'`).
 *
 * The app shell has one inline script (the no-flash theme preflight) and the
 * Astro site a handful per page; hashing them at boot lets exactly those run
 * while any injected inline script is refused. The hashes are computed from
 * the files actually on disk, so a rebuilt frontend never needs a code
 * change here — only a restart, which every deploy does anyway. Directories
 * that are unset or missing contribute nothing (dev, e2e, API-only).
 */
export function inlineScriptHashes(dirs: Array<string | undefined>): string[] {
  const hashes = new Set<string>();
  for (const dir of dirs) {
    if (dir === undefined || dir.trim() === "") continue;
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) continue;
    for (const file of htmlFiles(root)) {
      const html = fs.readFileSync(file, "utf8");
      for (const match of html.matchAll(INLINE_SCRIPT)) {
        const [, attrs, body] = match;
        if (/\bsrc\s*=/i.test(attrs) || body.length === 0) continue;
        // JSON data blocks are not executed and need no hash.
        if (/type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs)) continue;
        const digest = createHash("sha256")
          .update(body, "utf8")
          .digest("base64");
        hashes.add(`'sha256-${digest}'`);
      }
    }
  }
  return [...hashes].sort();
}

function htmlFiles(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0 && found.length < MAX_HTML_FILES) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        found.push(full);
        if (found.length >= MAX_HTML_FILES) break;
      }
    }
  }
  return found;
}
