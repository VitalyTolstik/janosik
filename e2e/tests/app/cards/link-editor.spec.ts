import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";

test("choosing another relation type keeps the link editor open", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Source card");
  await board.card(todo, "Target card");
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Source card" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog.getByRole("button", { name: "Link card" }).click();
  const input = page.getByTestId("card-links-input");
  await expect(input).toBeFocused();
  await input.pressSequentially("Target");
  await expect(page.getByTestId("card-links-suggestion")).toBeVisible();

  await page.getByTestId("card-links-type").click();
  await page.getByTestId("card-links-type-blockedBy").click();

  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Target");
  await expect(input).toBeFocused();
  await expect(page.getByTestId("card-links-suggestion")).toBeVisible();
});

test("clicking outside an open relation menu only closes the menu", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Source card");
  await board.card(todo, "Target card");
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Source card" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog.getByRole("button", { name: "Link card" }).click();
  const input = page.getByTestId("card-links-input");
  await expect(input).toBeFocused();

  await page.getByTestId("card-links-type").click();
  await expect(page.getByTestId("card-links-type-blocks")).toBeVisible();

  const description = page.getByText("Description", { exact: true });
  const box = await description.boundingBox();
  if (!box) throw new Error("Description is not visible");
  await page.mouse.click(box.x + 8, box.y + 8);

  await expect(page.getByTestId("card-links-type-blocks")).toBeHidden();
  await expect(input).toBeVisible();
});

test.describe("mobile card-link removal", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("keeps the remove action visible with a 44 px target", async ({
    page,
    board,
  }) => {
    const todo = await board.column("Todo");
    const cardId = await board.card(todo, "Source card");
    const targetCardId = await board.card(todo, "Target card");
    await board.command({
      type: "ADD_CARD_LINK",
      cardId,
      linkId: randomUUID(),
      targetCardId,
      linkType: "relates_to",
    });
    await board.open(page);
    await page
      .getByTestId("card-title")
      .filter({ hasText: "Source card" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Card details" });
    const row = dialog
      .getByTestId("card-link-row")
      .filter({ hasText: "Target card" });
    await expect(row).toBeVisible();

    // Touch has no hover: the row action is visible without a hover.
    const remove = row.getByTestId("card-link-remove");
    await expect(remove).toBeVisible();
    expect(
      await remove.evaluate((element) => getComputedStyle(element).opacity),
    ).toBe("1");
    const box = await remove.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await remove.click();
    await expect(dialog.getByTestId("card-link-row")).toHaveCount(0);
  });
});
