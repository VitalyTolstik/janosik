import { expect, test, type Page } from "@playwright/test";

import { sitePage } from "@/helpers/urls.js";

/**
 * Pricing page (`/pricing/`): the plan cards, their limits, the comparison
 * table, the FAQ and the two kinds of CTA (self-host on GitHub, cloud
 * waitlist by email).
 */

/** The plan card whose heading is exactly `name`. */
function plan(page: Page, name: string) {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("shows the plan cards with prices and limits", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );

  const selfhost = plan(page, "Self-hosted");
  await expect(selfhost).toBeVisible();
  await expect(selfhost).toContainText("Available now");
  await expect(selfhost).toContainText("$0");
  await expect(selfhost).toContainText("forever");
  await expect(selfhost).toContainText(
    "Boards: Unlimited · Members: Unlimited · Storage: Your disk",
  );

  const cloud = plan(page, "Cloud");
  await expect(cloud).toBeVisible();
  await expect(cloud).toContainText("Managed hosting");
  await expect(cloud).toContainText("Not available yet");
  await expect(cloud).toContainText(
    "Boards: Unlimited · Members: Unlimited · Storage: Cloud storage",
  );
});

test("shows the plan comparison table", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  const region = page.getByRole("region", { name: "Plan comparison" });
  await expect(region).toBeVisible();

  const table = region.getByRole("table");
  await expect(
    table.getByRole("columnheader", { name: "Self-hosted" }),
  ).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Cloud" }),
  ).toBeVisible();
  await expect(
    table.getByRole("rowheader", { name: "Board members" }),
  ).toBeVisible();
  const shares = table.getByRole("row", { name: /Read-only share links/ });
  await expect(shares.getByText("Included", { exact: true })).toHaveCount(2);

  const storage = table.getByRole("row", { name: /Attachment storage/ });
  await expect(storage).toContainText("Your disk");
  await expect(storage).toContainText("Cloud storage");
});

test("expands a pricing FAQ answer", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  const faq = page.locator(".faq");
  await expect(faq.locator("details")).toHaveCount(4);

  const question = faq.getByText("Is the managed cloud available?", {
    exact: true,
  });
  const answer = faq.getByText(
    "Not yet. Email us if you would like to hear about the managed cloud.",
  );

  await expect(question).toBeVisible();
  await expect(answer).toBeHidden();

  await question.click();

  await expect(answer).toBeVisible();
});

test("sends self-hosters to GitHub and cloud visitors to the waitlist", async ({
  page,
}) => {
  await page.goto(sitePage("/pricing/"));

  await expect(page.locator('[data-cta="plan-selfhost"]')).toHaveAttribute(
    "href",
    "https://github.com/VitalyTolstik/janosik",
  );
  await expect(page.locator('[data-cta="plan-cloud"]')).toHaveAttribute(
    "href",
    /^mailto:hello@janosik\.app\?subject=Janosik%20managed%20cloud$/,
  );
});

test("shows the closing call to action", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await expect(
    page.getByRole("heading", {
      name: "Run Janosik on your own server",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('[data-cta="pricing-signup"]')).toBeVisible();
  await expect(page.locator('[data-cta="pricing-github"]')).toBeVisible();
});
