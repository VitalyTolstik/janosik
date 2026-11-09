import { expect, test } from "@playwright/test";

import { DOCS_PAGES, docsUrl } from "@/helpers/docs.js";
import { siteUrl } from "@/helpers/urls.js";

/**
 * Full docs link graph: parse every anchor on all 46 pages, then fetch every
 * internal target (status 200) and verify that each `#fragment` exists as an
 * `id` on the target page. External hosts are checked as URLs only.
 */

const origin = new URL(siteUrl).origin;

test("every internal docs link and fragment resolves", async ({ request }) => {
  test.slow();

  const html = new Map<string, Promise<string>>();
  const load = (url: string): Promise<string> => {
    const key = `${url}`;
    let pending = html.get(key);
    if (pending === undefined) {
      pending = request.get(url).then(async (response) => {
        expect(response.status(), url).toBe(200);
        return response.text();
      });
      html.set(key, pending);
    }
    return pending;
  };

  const targets = new Set<string>();
  for (const lang of ["en", "ru"] as const) {
    for (const path of DOCS_PAGES) {
      const pageUrl = docsUrl(path, lang);
      const body = await load(pageUrl);
      const hrefs = [...body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(
        (match) => match[1].replaceAll("&amp;", "&"),
      );

      for (const href of hrefs) {
        expect(href, pageUrl).not.toBe("#");
        if (href === "") continue;
        const target = new URL(href, pageUrl);
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          continue;
        }
        if (target.origin !== origin) continue;
        targets.add(target.href);
      }
    }
  }

  // Sidebar + top nav + footer + inline links across 46 pages; guards against
  // the parser silently matching nothing after a markup change.
  expect(targets.size).toBeGreaterThan(100);

  for (const target of targets) {
    const url = new URL(target);
    const body = await load(`${url.origin}${url.pathname}${url.search}`);
    if (url.hash === "") continue;
    const id = decodeURIComponent(url.hash.slice(1));
    expect(body, `${target} should contain id="${id}"`).toContain(`id="${id}"`);
  }
});
