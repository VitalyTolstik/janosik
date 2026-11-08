import { expect, test } from "@playwright/test";

import { sitePage } from "@/helpers/urls.js";

/**
 * Landing page (`/`): the hero, the main section headings, the feature rows
 * and the FAQ. The marketing page is public, so every test starts from a fresh
 * browser context without an account.
 */

test("shows the hero headline, lead and primary actions", async ({ page }) => {
  await page.goto(sitePage("/"));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kanban for your agent swarm.",
  );
  await expect(
    page.getByText(
      "Connect your AI agents to Janosik. They move cards, add comments and update checklists through the API. Your team sees changes as they happen.",
    ),
  ).toBeVisible();
  await expect(page.locator('[data-cta="hero-signup"]')).toBeVisible();
  await expect(page.locator('[data-cta="hero-github"]')).toBeVisible();
  await expect(
    page.getByText("Free and open source (AGPL-3.0). Your data stays yours."),
  ).toBeVisible();
});

test("shows every main landing section", async ({ page }) => {
  await page.goto(sitePage("/"));

  for (const heading of [
    "How a swarm works the board",
    "A board for your team's work",
    "More ways to stay organized",
    "Open source. Self-hosted. Under your control.",
    "Running in minutes",
    "Questions",
    "Free to self-host, forever",
    "Ready to plan?",
  ]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
});

test("shows the feature rows and the extra capabilities", async ({ page }) => {
  await page.goto(sitePage("/"));

  const features = page.locator("#features");
  for (const heading of [
    "Move cards and switch between four views",
    "Everyone sees changes as they happen",
    "Everything for a task, in one card",
    "Share boards and keep control of your data",
    "Follow the board in real time",
  ]) {
    await expect(
      features.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }

  const more = page.locator(".more-grid");
  await expect(more).toContainText("Scoped, rate-limited API keys for agents");
  await expect(more).toContainText("Acceptance criteria & Definition of Done");
});

test("expands a FAQ answer", async ({ page }) => {
  await page.goto(sitePage("/"));

  const faq = page.locator(".faq");
  await expect(faq.locator("details")).toHaveCount(8);

  const question = faq.getByText("Can AI agents use Janosik?", {
    exact: true,
  });
  const answer = faq.getByText(
    "Yes. Create a personal API token for the board and connect your agent to the API. Agents can move cards, add comments and update checklists. Board commands support undo, and the activity history identifies changes made by a person or an agent.",
  );

  await expect(question).toBeVisible();
  await expect(answer).toBeHidden();

  await question.click();

  await expect(answer).toBeVisible();
});
