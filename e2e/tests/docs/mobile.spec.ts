import { expect, test } from "@playwright/test";

import {
  docsUrl,
  openDocs,
  openSearch,
  searchDialog,
  searchInput,
} from "@/helpers/docs.js";

/**
 * Docs on a phone: no horizontal overflow, the header search opens, and the
 * hamburger exposes the sidebar navigation (a popover pane at this width).
 */

test.use({ viewport: { width: 375, height: 812 } });

test("opens search and the sidebar on a mobile viewport", async ({ page }) => {
  await openDocs(page);

  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);

  await openSearch(page);
  await expect(searchDialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();

  const menu = page.locator("button.sl-menu-button");
  await expect(menu).toBeVisible();
  await menu.click();

  const pane = page.locator("#starlight__sidebar");
  await expect(pane).toBeVisible();
  const link = pane.getByRole("link", { name: "Self-hosting", exact: true });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(docsUrl("self-hosting/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Self-hosting" }),
  ).toBeVisible();
});
