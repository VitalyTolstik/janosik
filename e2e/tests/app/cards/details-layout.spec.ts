import { test, expect } from "@/fixtures/board.js";

test("card details adapt to desktop and mobile without losing actions", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  await board.card(column, "Responsive task");
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Responsive task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  const main = dialog.getByRole("main");
  const sidebar = dialog.getByRole("complementary");
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Responsive task",
  );
  await expect(sidebar.getByTestId("card-dates")).toContainText("Created");
  const title = dialog.getByRole("textbox", { name: "Title" });
  const copy = dialog.getByTestId("card-copy-link");
  expect(await title.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(48);
  // The title is focused on open, so focus-within already reveals the copy
  // button; blur it first or the hover assertion would pass vacuously.
  await page.getByTestId("card-dates").click();
  await expect(copy.locator("..")).toHaveCSS("opacity", "0");
  await title.hover();
  await expect(copy.locator("..")).toHaveCSS("opacity", "1");
  const titleBox = await title.boundingBox();
  const copyBox = await copy.boundingBox();
  expect(copyBox!.x - (titleBox!.x + titleBox!.width)).toBeLessThan(16);

  // A long title must not push the copy button under the actions menu.
  await title.fill(
    "A deliberately long card title that exhausts the header width ".repeat(4),
  );
  const longCopyBox = await copy.boundingBox();
  const actionsBox = await dialog
    .getByRole("button", { name: "Card actions" })
    .boundingBox();
  expect(longCopyBox!.x + longCopyBox!.width).toBeLessThanOrEqual(
    actionsBox!.x,
  );

  // Opening on pointer-down must not scale the anchor and move its menu.
  // The open menu aria-hides the dialog, so address the trigger by test id
  // instead of the dialog-scoped locator; close the menu before measuring
  // the rest of the dialog.
  const priority = page.getByTestId("priority-trigger");
  await priority.hover();
  const beforePress = await priority.boundingBox();
  await page.mouse.down();
  expect(
    await priority.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
  const duringPress = await priority.boundingBox();
  expect(duringPress!.x).toBeCloseTo(beforePress!.x, 1);
  expect(duringPress!.width).toBeCloseTo(beforePress!.width, 1);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  const desktopMain = await main.boundingBox();
  const desktopSidebar = await sidebar.boundingBox();
  expect(desktopMain).not.toBeNull();
  expect(desktopSidebar).not.toBeNull();
  expect(desktopSidebar!.x).toBeGreaterThan(desktopMain!.x);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMain = await main.boundingBox();
  const mobileSidebar = await sidebar.boundingBox();
  expect(mobileMain).not.toBeNull();
  expect(mobileSidebar).not.toBeNull();
  expect(mobileMain!.y).toBeGreaterThanOrEqual(
    mobileSidebar!.y + mobileSidebar!.height - 1,
  );
  await expect(dialog.getByTestId("card-copy-link")).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open in new tab" }),
  ).toBeVisible();
});
