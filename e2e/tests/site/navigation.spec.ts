import { expect, test } from "@playwright/test";

import { sitePage } from "@/helpers/urls.js";

/**
 * Marketing-site navigation: the header and footer reach the landing page,
 * pricing and the documentation, the features link lands on the home anchor,
 * and browser Back returns to the previous page.
 */

test("header Pricing link opens the pricing page", async ({ page }) => {
  await page.goto(sitePage("/"));

  await page
    .locator("header .site-nav")
    .getByRole("link", { name: "Pricing" })
    .click();

  await expect(page).toHaveURL(sitePage("/pricing/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );
});

test("header Docs link opens the documentation", async ({ page }) => {
  await page.goto(sitePage("/"));

  await page
    .locator("header .site-nav")
    .getByRole("link", { name: "Docs" })
    .click();

  await expect(page).toHaveURL(sitePage("/docs/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Documentation" }),
  ).toBeVisible();
});

test("header Features link returns to the home features section", async ({
  page,
}) => {
  await page.goto(sitePage("/pricing/"));

  await page
    .locator("header .site-nav")
    .getByRole("link", { name: "Features" })
    .click();

  await expect(page).toHaveURL(sitePage("/#features"));
  await expect(page.locator("#features")).toBeInViewport();
});

test("header brand returns to the home page", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await page.locator("header a.brand").click();

  await expect(page).toHaveURL(sitePage("/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kanban for your agent swarm.",
  );
});

test("footer Pricing link opens the pricing page", async ({ page }) => {
  await page.goto(sitePage("/"));

  await page
    .locator("footer")
    .getByRole("link", { name: "Pricing", exact: true })
    .click();

  await expect(page).toHaveURL(sitePage("/pricing/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );
});

test("footer documentation link opens the documentation", async ({ page }) => {
  await page.goto(sitePage("/"));

  await page
    .locator("footer")
    .getByRole("link", { name: "Docs", exact: true })
    .click();

  await expect(page).toHaveURL(sitePage("/docs/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Documentation" }),
  ).toBeVisible();
});

test("footer brand returns to the home page", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await page.locator("footer a.brand").click();

  await expect(page).toHaveURL(sitePage("/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kanban for your agent swarm.",
  );
});

test("footer self-hosting guide opens the documentation", async ({ page }) => {
  await page.goto(sitePage("/"));

  await page
    .locator("footer")
    .getByRole("link", { name: "Self-hosting guide" })
    .click();

  await expect(page).toHaveURL(sitePage("/docs/self-hosting/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Self-hosting" }),
  ).toBeVisible();
});

test("browser Back returns to the page the visitor came from", async ({
  page,
}) => {
  await page.goto(sitePage("/pricing/"));

  await page
    .locator("header .site-nav")
    .getByRole("link", { name: "Docs" })
    .click();
  await expect(page).toHaveURL(sitePage("/docs/"));

  await page.goBack();

  await expect(page).toHaveURL(sitePage("/pricing/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );
});
