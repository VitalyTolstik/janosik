import { test, expect } from "../../../fixtures/board.js";

test("copy a card link from its details and open it in another tab", async ({
  page,
  context,
  board,
}) => {
  const column = await board.column("Tasks");
  const cardId = await board.card(column, "Linked task");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Linked task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog.getByRole("textbox", { name: "Title" }).hover();
  await dialog.getByTestId("card-copy-link").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const url = new URL(copied);
  expect(url.pathname).toContain(`/board/${board.id}`);
  expect(url.searchParams.get("card")).toBe(cardId);

  const newTab = await context.newPage();
  await newTab.goto(copied);
  await expect(
    newTab.getByRole("dialog", { name: "Card details" }),
  ).toBeVisible();
  await expect(newTab.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Linked task",
  );
});
