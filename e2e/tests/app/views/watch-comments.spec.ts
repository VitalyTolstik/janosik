import { test, expect } from "@/fixtures/board.js";

test("watch displays an added comment and its text", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const response = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: "Ready for review" },
  });
  expect(response.status()).toBe(201);
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Added a comment" });
  await expect(entry).toContainText("Ready for review", { timeout: 15000 });
});

test("watch stacks meta above a long diff without overflow at 768 and 390", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Responsive feed");
  const prefix = "LONG-CONTEXT ".repeat(20);
  const suffix = " TAIL-MARKER ".repeat(20);
  const created = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: `${prefix}old ending${suffix}` },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const edited = await board.api.patch(`/api/v1/comments/${id}`, {
    data: { text: `${prefix}new ending${suffix}` },
  });
  expect(edited.ok()).toBeTruthy();

  await page.setViewportSize({ width: 768, height: 1024 });
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Edited a comment" })
    .first();
  await expect(entry).toBeVisible({ timeout: 15000 });

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await expect(entry).toBeVisible();
    const metrics = await page.evaluate(() => {
      const feed = document.querySelector<HTMLElement>(
        '[data-testid="watch-feed"]',
      )!;
      const row = feed.querySelector<HTMLElement>(
        '[data-testid="watch-entry"]',
      )!;
      const body = row.querySelector<HTMLElement>(
        '[data-testid="watch-entry-body"]',
      )!;
      const time = row.querySelector<HTMLElement>(
        '[data-testid="watch-entry-time"]',
      )!;
      const actor = row.querySelector<HTMLElement>(
        '[data-testid="watch-entry-actor"]',
      )!;
      const timeBox = time.getBoundingClientRect();
      const actorBox = actor.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        pageOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        feedOverflow: feed.scrollWidth - feed.clientWidth,
        bodyWidth: bodyBox.width,
        rowHeight: row.getBoundingClientRect().height,
        metaBottom: Math.max(timeBox.bottom, actorBox.bottom),
        bodyTop: bodyBox.top,
      };
    });
    expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
    expect(metrics.feedOverflow).toBeLessThanOrEqual(1);
    expect(metrics.bodyWidth).toBeGreaterThan(width * 0.55);
    expect(metrics.rowHeight).toBeLessThan(480);
    // Time and actor sit above the story, not in fixed columns beside it.
    expect(metrics.metaBottom).toBeLessThanOrEqual(metrics.bodyTop + 1);
  }

  // The compact feed row is truncated; the full snapshot stays reachable.
  const before = (await entry.textContent())?.length ?? 0;
  await entry.getByRole("button", { name: "Show full values" }).click();
  await expect(entry.getByText("TAIL-MARKER").first()).toBeVisible();
  expect((await entry.textContent())?.length ?? 0).toBeGreaterThan(before);
});

test("watch renders a deleted comment as a text-free tombstone", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  const response = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: "Obsolete comment" },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Added a comment" }),
  ).toBeVisible();
  const removed = await board.api.delete(`/api/v1/comments/${id}`);
  expect(removed.ok()).toBeTruthy();

  // TASK-185.2 protected feed: after deletion the edit is filtered and both
  // comment fences are metadata-only tombstones — no body, changes or raw
  // details reach Watch.
  const feedResponse = await board.api.get(`/api/v1/cards/${card}/activity`);
  expect(feedResponse.ok()).toBeTruthy();
  const feed = (await feedResponse.json()) as {
    items: Array<{
      type: string;
      commentId?: string;
      detail?: string;
      changes?: unknown;
      details?: unknown;
    }>;
  };
  expect(feed.items.some((item) => item.type === "comment_updated")).toBe(
    false,
  );
  const deleted = feed.items.find((item) => item.type === "comment_deleted");
  expect(deleted).toMatchObject({ commentId: id });
  expect(deleted?.detail).toBeUndefined();
  expect(deleted?.changes).toBeUndefined();
  expect(deleted?.details).toBeUndefined();
  expect(JSON.stringify(deleted)).not.toContain("Obsolete comment");

  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Deleted a comment" });
  await expect(entry).toBeVisible({ timeout: 15000 });
  await expect(entry.locator(".line-through")).toHaveCount(0);
  await expect(entry).not.toContainText("Obsolete comment");
  await expect(page.getByTestId("watch-feed")).not.toContainText(
    "Obsolete comment",
  );
});
