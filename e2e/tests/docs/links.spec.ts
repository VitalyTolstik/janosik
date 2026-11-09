import { expect, test } from "@playwright/test";

import { docsUrl, openDocs } from "@/helpers/docs.js";
import { siteUrl } from "@/helpers/urls.js";

const samplePages = [
  { path: "", lang: "en" as const },
  { path: "getting-started/", lang: "en" as const },
  { path: "user-guide/boards/", lang: "en" as const },
  { path: "api/commands/", lang: "en" as const },
  { path: "self-hosting/", lang: "en" as const },
  { path: "faq/", lang: "en" as const },
  { path: "", lang: "ru" as const },
  { path: "getting-started/", lang: "ru" as const },
  { path: "user-guide/boards/", lang: "ru" as const },
  { path: "api/commands/", lang: "ru" as const },
  { path: "self-hosting/", lang: "ru" as const },
  { path: "faq/", lang: "ru" as const },
];

test("every sampled inline docs link resolves to a real page", async ({
  page,
  request,
}) => {
  const siteOrigin = new URL(siteUrl).origin;
  const docsRoot = new URL(docsUrl()).pathname;
  const ruDocsRoot = new URL(docsUrl("", "ru")).pathname;
  const targets = new Set<string>();

  for (const sample of samplePages) {
    const pageUrl = docsUrl(sample.path, sample.lang);
    await openDocs(page, sample.path, sample.lang);

    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

    for (const href of hrefs) {
      if (href === null || href.startsWith("#") || href.startsWith("mailto:")) {
        continue;
      }
      const target = new URL(href, pageUrl);
      if (target.origin !== siteOrigin) continue;
      if (
        !target.pathname.startsWith(docsRoot) &&
        !target.pathname.startsWith(ruDocsRoot)
      ) {
        continue;
      }
      target.hash = "";
      targets.add(target.href);
    }
  }

  // Guard against a silently empty sample if the markup changes.
  expect(targets.size).toBeGreaterThan(20);

  const responses = await Promise.all(
    [...targets].map(async (target) => ({
      target,
      status: (await request.get(target)).status(),
    })),
  );
  const broken = responses
    .filter((response) => response.status !== 200)
    .map((response) => `${response.status} ${response.target}`);

  expect(broken).toEqual([]);
});

test("moves through the user guide with previous and next links", async ({
  page,
}) => {
  await openDocs(page, "user-guide/boards/");

  const pagination = page.locator(".pagination-links");
  await expect(pagination.locator('a[rel="prev"]')).toHaveAttribute(
    "href",
    new URL(docsUrl("user-guide/")).pathname,
  );
  await expect(pagination.locator('a[rel="next"]')).toHaveAttribute(
    "href",
    new URL(docsUrl("user-guide/workflow/")).pathname,
  );

  await pagination.locator('a[rel="next"]').click();

  await expect(page).toHaveURL(docsUrl("user-guide/workflow/"));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Board workflow",
    }),
  ).toBeVisible();

  await page.locator('.pagination-links a[rel="prev"]').click();

  await expect(page).toHaveURL(docsUrl("user-guide/boards/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Boards, columns and cards" }),
  ).toBeVisible();
});
