import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every internal docs link must land on a real page. With
 * `trailingSlash: "always"` a page lives at `/docs/faq/`, so a bare relative
 * link such as `self-hosting/` resolves to `/docs/faq/self-hosting/` — a 404
 * that reads fine in the source. Links are resolved the way a browser does.
 */
const DOCS_ROOT = fileURLToPath(new URL("../content/docs", import.meta.url));
const LINK = /\]\(([^)\s]+)\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.mdx?$/.test(entry.name) ? [full] : [];
  });
}

/** `docs/user-guide/index.md` → `/docs/user-guide/`. */
function pageUrl(file: string): string {
  const slug = path
    .relative(DOCS_ROOT, file)
    .split(path.sep)
    .join("/")
    .replace(/\.mdx?$/, "")
    .replace(/(^|\/)index$/, "");
  return slug === "" ? "/" : `/${slug}/`;
}

const files = walk(DOCS_ROOT);
const pages = new Set(files.map(pageUrl));

describe("docs internal links", () => {
  it.each(files.map((file) => [pageUrl(file), file]))(
    "%s links only to existing pages",
    (url, file) => {
      const broken: string[] = [];
      for (const [, link] of readFileSync(file, "utf8").matchAll(LINK)) {
        if (link === undefined || /^(https?:|mailto:|#)/.test(link)) continue;
        const target = new URL(link, `https://site${url}`).pathname;
        if (!/^\/(ru\/)?docs\//.test(target)) continue;
        if (/\.[a-z0-9]+$/i.test(target)) continue; // static assets
        if (!pages.has(target)) broken.push(`${link} → ${target}`);
      }
      expect(broken).toEqual([]);
    },
  );
});
