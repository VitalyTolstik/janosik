import { test, expect } from "../../../fixtures/card-context-menu.js";

test("context menu opens the card, copies its link and opens a new tab", async ({
  page,
  context,
  contextCard,
  board,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await contextCard.openMenu();
  await page.getByTestId("ctx-copy-link").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`board/${board.id}?card=${contextCard.id}`);
  await contextCard.openMenu();
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("ctx-open-new-tab").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(
    new RegExp(`board/${board.id}\\?card=${contextCard.id}`),
  );
  await expect(
    popup.getByRole("dialog", { name: "Card details" }),
  ).toBeVisible();
  await popup.close();
  await contextCard.openMenu();
  await page.getByTestId("ctx-open").click();
  await expect(
    page.getByRole("dialog", { name: "Card details" }),
  ).toBeVisible();
});

test("context menu duplicates and archives a card", async ({
  page,
  contextCard,
}) => {
  await contextCard.openMenu();
  await page.getByTestId("ctx-duplicate").click();
  await expect(
    page
      .getByTestId("card-title")
      .filter({ hasText: /^Copy of Context task$/ }),
  ).toBeVisible();
  await contextCard.openMenu();
  await page.getByTestId("ctx-archive").click();
  await expect(
    page.getByTestId("card-title").filter({ hasText: /^Context task$/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByTestId("card-title")
      .filter({ hasText: /^Copy of Context task$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  await expect(page.getByTestId("archive-row")).toContainText("Context task");
});
