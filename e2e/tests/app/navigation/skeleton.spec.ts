import { test, expect } from "@/fixtures/navigation.js";
import { delayNextRoute } from "@/helpers/network.js";

/**
 * Loading skeletons (SKELETON-AUDIT §4.2/4.4/4.6): the board shell reserves
 * the real geometry before the snapshot arrives, the card dialog separates
 * loading from empty, and reduced motion drops the shimmer.
 */

test("reserves the board shell until the snapshot arrives", async ({
  page,
  board,
  navigation,
}) => {
  await board.open(page);

  await delayNextRoute(page, `**/api/v1/boards/${board.id}`, 1500);
  await page.goto(navigation.boardUrl);

  const skeleton = page.getByTestId("board-shell-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("board-skeleton-column")).toHaveCount(4);
  await expect(page.getByTestId("board-skeleton-card").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: board.title })).toBeVisible({
    timeout: 10_000,
  });
  await expect(skeleton).toHaveCount(0);
});

test("uses one busy region per card section instead of a false empty state", async ({
  page,
  board,
  navigation,
}) => {
  const columnId = await board.column("Skeleton");
  const cardId = await board.card(columnId, "Skeleton card");
  const comment = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "Loaded comment" },
  });
  expect(comment.status()).toBe(201);

  await board.open(page);
  await delayNextRoute(page, `**/api/v1/cards/${cardId}/comments*`, 1500);
  await delayNextRoute(page, `**/api/v1/cards/${cardId}/activity*`, 1500);
  await delayNextRoute(page, `**/api/v1/cards/${cardId}/attachments*`, 1500);
  await page.goto(navigation.cardUrl(cardId));

  const comments = page.getByTestId("card-comments-skeleton");
  await expect(comments).toBeVisible();
  await expect(comments).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("No comments yet")).toHaveCount(0);
  await expect(page.getByTestId("card-history-skeleton")).toHaveCount(1);
  await expect(page.getByTestId("card-attachments-skeleton")).toBeVisible();

  await expect(
    page.getByTestId("comment").filter({ hasText: "Loaded comment" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(comments).toHaveCount(0);
});

test("disables the shimmer when reduced motion is requested", async ({
  page,
  board,
  navigation,
}) => {
  await board.open(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await delayNextRoute(page, `**/api/v1/boards/${board.id}`, 1500);
  await page.goto(navigation.boardUrl);

  const skeleton = page.getByTestId("board-shell-skeleton");
  await expect(skeleton).toBeVisible();
  expect(
    await skeleton.evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  expect(
    await page
      .locator("[data-skeleton-bar]")
      .first()
      .evaluate((node) => getComputedStyle(node, "::after").display),
  ).toBe("none");
});
