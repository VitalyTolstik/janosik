import { test, expect } from "../../../fixtures/board.js";

test("create, edit, drag, duplicate, archive, restore and delete a card", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.column("Doing");
  await board.open(page);
  const todo = page
    .locator("section")
    .filter({ has: page.getByRole("group", { name: "Todo", exact: true }) });
  const doing = page
    .locator("section")
    .filter({ has: page.getByRole("group", { name: "Doing", exact: true }) });
  await todo.locator("[data-composer-trigger]").click();
  await todo.locator('[name="card-composer"]').fill("Draft task");
  await todo.locator('[name="card-composer"]').press("Enter");
  await todo
    .getByTestId("card-title")
    .filter({ hasText: "Draft task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Updated task");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(todo.getByTestId("card-title")).toHaveText("Updated task");
  const source = await todo.getByTestId("card-title").boundingBox();
  const target = await doing.getByTestId("column-card-scroll").boundingBox();
  if (!source || !target)
    throw new Error("Card or target column is not visible");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 10,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(target.x + target.width / 2, target.y + 50, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(doing.getByTestId("card-title")).toHaveText("Updated task");
  await page.reload();
  await doing.getByRole("group", { name: "Updated task", exact: true }).focus();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate card" }).click();
  await expect(
    doing.getByTestId("card-title").filter({ hasText: "Copy of Updated task" }),
  ).toBeVisible();
  await doing
    .getByTestId("card-title")
    .filter({ hasText: /^Updated task$/ })
    .click();
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  const row = page.getByTestId("archive-row");
  await expect(row).toHaveCount(1);
  await row.getByTestId("archive-restore").click();
  await page.getByRole("menuitem", { name: "Todo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close" })
    .first()
    .click();
  await expect(todo.getByTestId("card-title")).toBeVisible();
  await page.reload();
  await expect(todo.getByTestId("card-title")).toBeVisible();
  await todo.getByTestId("card-title").click();
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await page
    .getByRole("dialog", { name: "Delete this card?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(todo.getByTestId("card-title")).toHaveCount(0);
  // Deleting the open card must not look like a stale deep link: the dialog
  // clears ?card= itself, so the board never reports "Card not found".
  await expect(page).not.toHaveURL(/[?&]card=/);
  await expect(
    page.getByRole("status").filter({ hasText: "Card not found" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(todo.getByTestId("card-title")).toHaveCount(0);
  await expect(doing.getByTestId("card-title")).toHaveCount(1);
});
