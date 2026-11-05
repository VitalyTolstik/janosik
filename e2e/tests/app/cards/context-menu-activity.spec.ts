import { test, expect } from "../../../fixtures/card-context-menu.js";

test("context menu creates and checks checklist items and sends comments", async ({
  page,
  contextCard,
}) => {
  await contextCard.openSubmenu("checklist");
  const title = page.getByTestId("ctx-checklist-new");
  await title.fill("Release checklist");
  await title.press("Enter");
  const addItem = page.locator('[data-testid^="ctx-checklist-add-item-"]');
  await addItem.fill("Check release");
  await addItem.press("Enter");
  const item = page.locator('[data-testid^="ctx-checklist-item-"]');
  await expect(item).toContainText("Check release");
  await item.click();
  await contextCard.openSubmenu("comment");
  await page.getByTestId("ctx-comment-input").fill("Comment from context menu");
  await page.getByTestId("ctx-comment-send").click();
  await expect(page.getByTestId("card-context-menu")).toHaveCount(0);
  await page.reload();
  await page
    .getByTestId("card-title")
    .filter({ hasText: /^Context task$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(
    dialog.getByText("Release checklist", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    dialog
      .locator("li")
      .filter({ hasText: "Check release" })
      .first()
      .locator('button[aria-pressed="true"]'),
  ).toBeVisible();
  await expect(dialog.getByTestId("comment-list")).toContainText(
    "Comment from context menu",
  );
});
