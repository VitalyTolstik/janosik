import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { docsUrl, openDocs } from "@/helpers/docs.js";

/**
 * Documentation rendering: code blocks with a working copy button, tables,
 * heading anchors with a table of contents, and the version badge next to the
 * docs title. Copy uses the real clipboard, so grant it explicitly.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const packageVersion = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).version as string;

test("copies code, renders tables and anchors, and shows the version", async ({
  page,
}) => {
  await openDocs(page, "self-hosting/");

  const copy = page.locator('.copy button[title="Copy to clipboard"]').first();
  await expect(copy).toBeVisible();
  await copy.click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("docker --version");
  expect(copied).toContain("docker compose version");

  const anchor = page.locator(
    ".sl-heading-wrapper:has(#what-the-stack-runs) .sl-anchor-link",
  );
  await expect(anchor).toHaveAttribute("href", "#what-the-stack-runs");
  await anchor.click();
  await expect(page).toHaveURL(/#what-the-stack-runs$/);
  await expect(page.locator("#what-the-stack-runs")).toBeVisible();

  await expect(page.locator("#starlight__on-this-page")).toBeVisible();
  const toc = page.locator("starlight-toc");
  await expect(
    toc.getByRole("link", { name: "What the stack runs" }),
  ).toBeVisible();

  await page.goto(docsUrl("admin/settings/"));
  const table = page.locator("main table").first();
  await expect(table).toBeVisible();
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(3);
  await expect(table).toContainText("Delivery is active");

  await page.goto(docsUrl());
  const badge = page.locator(".docs-version");
  await expect(badge).toHaveText(`v${packageVersion}`);
  await expect(badge).toHaveAttribute("title", `Janosik ${packageVersion}`);
});
