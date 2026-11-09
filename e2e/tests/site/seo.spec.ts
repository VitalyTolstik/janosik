import { expect, test, type Page } from "@playwright/test";

import { DOCS_PAGES, docsPath } from "@/helpers/docs.js";
import { sitePage, sitePath } from "@/helpers/urls.js";

/**
 * Search-engine metadata on the marketing pages, plus the machine-readable
 * files (sitemap, robots, llms.txt, pricing.md and social cards). Everything
 * is public and generated at build time, so no account is needed.
 */

interface SeoCase {
  path: string;
  title: string;
  description: string;
  canonical: string;
  lang: "en" | "ru";
  locale: string;
  image: string;
  noindex?: boolean;
}

const homeDescription =
  "Give your AI agents one shared board. They reserve cards, move tasks, add comments and update checklists through the API. Free to self-host under AGPL-3.0.";
const pricingDescription =
  "Janosik is free to self-host under the AGPL-3.0 license. The managed cloud is not available yet. Run it on your own server.";
const notFoundDescription =
  "The page may have moved, been archived, or never existed. Try the home page or browse the documentation.";

const cases: SeoCase[] = [
  {
    path: "/",
    title: "Janosik — self-hosted Kanban for AI agents",
    description: homeDescription,
    canonical: "/",
    lang: "en",
    locale: "en_US",
    image: "/og.png",
  },
  {
    path: "/pricing/",
    title: "Pricing — free self-hosted edition, cloud not yet available",
    description: pricingDescription,
    canonical: "/pricing/",
    lang: "en",
    locale: "en_US",
    image: "/og-pricing.png",
  },
  {
    path: "/ru/",
    title: "Janosik — канбан для ИИ-агентов на вашем сервере",
    description:
      "Общая доска для команды ИИ-агентов. Они резервируют карточки, перемещают задачи, добавляют комментарии и обновляют чек-листы через API. Бесплатно на своём сервере по лицензии AGPL-3.0.",
    canonical: "/ru/",
    lang: "ru",
    locale: "ru_RU",
    image: "/og.png",
  },
  {
    path: "/ru/pricing/",
    title: "Тарифы Janosik — бесплатная версия для своего сервера",
    description:
      "Janosik можно бесплатно разместить на своём сервере по лицензии AGPL-3.0. Облачная версия пока недоступна.",
    canonical: "/ru/pricing/",
    lang: "ru",
    locale: "ru_RU",
    image: "/og-pricing.png",
  },
  {
    path: "/missing-page/",
    title: "Page not found — Janosik",
    description: notFoundDescription,
    canonical: "/404/",
    lang: "en",
    locale: "en_US",
    image: "/og.png",
    noindex: true,
  },
];

function meta(page: Page, attribute: "name" | "property", key: string) {
  return page.locator(`meta[${attribute}="${key}"]`).first();
}

async function expectAlternates(
  page: Page,
  expected: { en: string; ru: string },
): Promise<void> {
  const links = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        lang: node.getAttribute("hreflang"),
        href: node.getAttribute("href"),
      })),
    );
  const byLang = new Map(links.map((link) => [link.lang, link.href]));

  expect(byLang.get("en")).not.toBeNull();
  expect(byLang.get("ru")).not.toBeNull();
  expect(byLang.get("x-default")).toBe(byLang.get("en"));
  expect(new URL(byLang.get("en") ?? "").pathname).toBe(expected.en);
  expect(new URL(byLang.get("ru") ?? "").pathname).toBe(expected.ru);
}

test("serves complete SEO metadata on home, pricing, RU and 404", async ({
  page,
}) => {
  for (const current of cases) {
    const response = await page.goto(sitePage(current.path));
    expect(response?.status(), current.path).toBe(current.noindex ? 404 : 200);
    await expect(page, current.path).toHaveTitle(current.title);
    await expect(page.locator("html"), current.path).toHaveAttribute(
      "lang",
      current.lang,
    );

    await expect(meta(page, "name", "description")).toHaveAttribute(
      "content",
      current.description,
    );

    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical, current.path).not.toBeNull();
    const canonicalUrl = new URL(canonical ?? "");
    expect(canonicalUrl.pathname).toBe(
      current.canonical === "/404/"
        ? sitePath("/404/")
        : sitePath(current.canonical),
    );

    await expectAlternates(page, {
      en:
        current.canonical === "/404/"
          ? sitePath("/404/")
          : sitePath(
              current.canonical.startsWith("/ru/")
                ? current.canonical.slice(3)
                : current.canonical,
            ),
      ru:
        current.canonical === "/404/"
          ? sitePath("/ru/404/")
          : sitePath(
              current.canonical.startsWith("/ru/")
                ? current.canonical
                : `/ru${current.canonical}`,
            ),
    });

    await expect(meta(page, "property", "og:type")).toHaveAttribute(
      "content",
      "website",
    );
    await expect(meta(page, "property", "og:site_name")).toHaveAttribute(
      "content",
      "Janosik",
    );
    await expect(meta(page, "property", "og:title")).toHaveAttribute(
      "content",
      current.title,
    );
    await expect(meta(page, "property", "og:description")).toHaveAttribute(
      "content",
      current.description,
    );
    await expect(meta(page, "property", "og:url")).toHaveAttribute(
      "content",
      canonicalUrl.href,
    );
    await expect(meta(page, "property", "og:locale")).toHaveAttribute(
      "content",
      current.locale,
    );
    const ogImage = await meta(page, "property", "og:image").getAttribute(
      "content",
    );
    expect(new URL(ogImage ?? "").pathname).toBe(sitePath(current.image));

    await expect(meta(page, "name", "twitter:card")).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(meta(page, "name", "twitter:title")).toHaveAttribute(
      "content",
      current.title,
    );
    await expect(meta(page, "name", "twitter:description")).toHaveAttribute(
      "content",
      current.description,
    );
    const twitterImage = await meta(page, "name", "twitter:image").getAttribute(
      "content",
    );
    expect(new URL(twitterImage ?? "").pathname).toBe(sitePath(current.image));

    if (current.noindex) {
      await expect(meta(page, "name", "robots")).toHaveAttribute(
        "content",
        "noindex, nofollow",
      );
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    }

    const scripts = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(scripts.length, current.path).toBeGreaterThan(0);
    const nodes = scripts.flatMap((script) => JSON.parse(script));
    const types = nodes.map((node: { "@type": string }) => node["@type"]);
    expect(types, current.path).toEqual(
      expect.arrayContaining([
        "Organization",
        "WebSite",
        "SoftwareApplication",
      ]),
    );
    if (current.path === "/pricing/" || current.path === "/ru/pricing/") {
      expect(types).toEqual(
        expect.arrayContaining(["FAQPage", "Product", "BreadcrumbList"]),
      );
    }
  }
});

test("publishes sitemap, robots, llms.txt, pricing.md and social cards", async ({
  request,
}) => {
  const sitemapIndex = await request.get(sitePage("/sitemap-index.xml"));
  expect(sitemapIndex.status()).toBe(200);
  expect(sitemapIndex.headers()["content-type"]).toMatch(/xml/);
  const indexBody = await sitemapIndex.text();
  expect(indexBody).toContain("/sitemap-0.xml");

  const sitemap = await request.get(sitePage("/sitemap-0.xml"));
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toMatch(/xml/);
  const locations = [
    ...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g),
  ].map((match) => new URL(match[1]).pathname);

  for (const path of ["/", "/pricing/", "/ru/", "/ru/pricing/"]) {
    expect(locations, path).toContain(sitePath(path));
  }
  for (const path of DOCS_PAGES) {
    expect(locations, `en ${path}`).toContain(docsPath(path, "en"));
    expect(locations, `ru ${path}`).toContain(docsPath(path, "ru"));
  }
  expect(new Set(locations).size).toBe(locations.length);

  const robots = await request.get(sitePage("/robots.txt"));
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  const robotsBody = await robots.text();
  expect(robotsBody).toContain("User-agent: *");
  expect(robotsBody).toContain("Allow: /");
  const sitemapLine = robotsBody
    .split("\n")
    .find((line) => line.startsWith("Sitemap: "));
  expect(sitemapLine, "robots.txt must advertise the sitemap").toBeDefined();
  expect(new URL(sitemapLine?.slice("Sitemap: ".length) ?? "").pathname).toBe(
    sitePath("/sitemap-index.xml"),
  );

  const llms = await request.get(sitePage("/llms.txt"));
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toContain("text/plain");
  const llmsBody = await llms.text();
  expect(llmsBody).toMatch(/^# Janosik/m);
  expect(llmsBody).toContain("[Home](");
  expect(llmsBody).toContain("[Pricing](");
  expect(llmsBody).toContain("[Documentation](");
  expect(llmsBody).toContain("[Machine-readable pricing](");
  expect(llmsBody).toContain("AGPL-3.0");

  const pricing = await request.get(sitePage("/pricing.md"));
  expect(pricing.status()).toBe(200);
  expect(pricing.headers()["content-type"]).toContain("text/markdown");
  const pricingBody = await pricing.text();
  expect(pricingBody).toContain("# Pricing — Janosik");
  expect(pricingBody).toContain("## Plans");
  expect(pricingBody).toContain("### Self-hosted");
  expect(pricingBody).toContain("## Comparison");
  expect(pricingBody).toContain("AGPL-3.0");

  for (const image of ["/og.png", "/og-pricing.png", "/og-docs.png"]) {
    const response = await request.get(sitePage(image));
    expect(response.status(), image).toBe(200);
    expect(response.headers()["content-type"], image).toContain("image/png");
    expect((await response.body()).byteLength, image).toBeGreaterThan(1000);
  }
});
