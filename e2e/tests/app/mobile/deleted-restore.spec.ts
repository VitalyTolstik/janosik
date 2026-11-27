import { expect, test } from "@/fixtures/board.js";
import { openDataMenu } from "@/helpers/data.js";
import {
  expectInsideViewport,
  expectNoOwnOverflow,
  expectNoPageOverflow,
} from "@/helpers/touch.js";

/**
 * TASK-177.7 at phone width: the Data menu items and the Recently deleted
 * dialog must stay reachable, and closing the dialog must return focus to the
 * Data & backups trigger.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("Data menu and Recently deleted stay usable at 390", async ({
  page,
  board,
}) => {
  const column = await board.column("Recovery");
  const cardId = await board.card(column, "Recover me");
  await board.command({ type: "DELETE_CARD", cardId });
  await board.open(page);

  const trigger = page.getByTestId("board-menu-trigger");
  await openDataMenu(page);
  const exportItem = page.getByTestId("data-export-board");
  const deletedItem = page.getByTestId("data-deleted");
  for (const item of [exportItem, deletedItem]) {
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await deletedItem.click();
  const dialog = page.getByRole("dialog", { name: "Recently deleted" });
  await expect(dialog).toBeVisible();
  await expectInsideViewport(dialog, "recently deleted");
  await expectNoOwnOverflow(dialog, "recently deleted");
  await expectNoPageOverflow(page, "recently deleted");
  const close = dialog.getByTestId("dialog-close");
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(Math.min(closeBox!.width, closeBox!.height)).toBeGreaterThanOrEqual(
    44,
  );

  const row = dialog
    .getByTestId("deleted-row")
    .filter({ hasText: "Recover me" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Restore/ }).click();
  await expect(page.getByText("Restored")).toBeVisible();
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Recover me" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Data menu and dialog close targets are 44px at 768", async ({
  page,
  board,
}) => {
  await board.open(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await openDataMenu(page);
  for (const item of [
    page.getByTestId("data-export-board"),
    page.getByTestId("data-deleted"),
  ]) {
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId("data-deleted").click();
  const dialog = page.getByRole("dialog", { name: "Recently deleted" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByTestId("dialog-close");
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(Math.min(closeBox!.width, closeBox!.height)).toBeGreaterThanOrEqual(
    44,
  );
  await page.keyboard.press("Escape");
});
