import { test, expect } from "../../../fixtures/board.js";

test("create, rename, switch, archive, restore and delete boards across reloads", async ({
  page,
  board,
}) => {
  await board.open(page);
  const originalTitle = await page.locator("header h2").innerText();
  await page.getByRole("button", { name: "Switch board" }).click();
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByRole("textbox", { name: "Board name" }).fill("Roadmap board");
  await page.getByRole("textbox", { name: "Board name" }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Roadmap board" }),
  ).toBeVisible();
  await page.getByRole("heading", { name: "Roadmap board" }).click();
  await page.locator('[name="board-title-edit"]').fill("Renamed board");
  await page.locator('[name="board-title-edit"]').press("Enter");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Renamed board" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch board" }).click();
  const original = page
    .getByRole("option")
    .filter({ hasText: originalTitle })
    .first();
  await original.click();
  await expect(page).toHaveURL(new RegExp(board.id));
  await page.getByRole("button", { name: "Switch board" }).click();
  const row = page.getByRole("option").filter({ hasText: "Renamed board" });
  await row.hover();
  await row.getByRole("button", { name: "Archive board" }).click();
  await row.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByTestId("archived-section")).toContainText(
    "Renamed board",
  );
  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  const archived = page
    .getByTestId("archived-section")
    .locator("div")
    .filter({ hasText: "Renamed board" })
    .last();
  await archived.getByRole("button", { name: "Restore board" }).click();
  await expect(
    page.getByRole("option").filter({ hasText: "Renamed board" }),
  ).toBeVisible();
  const restored = page
    .getByRole("option")
    .filter({ hasText: "Renamed board" });
  await restored.hover();
  await restored.getByRole("button", { name: "Archive board" }).click();
  await restored.getByRole("button", { name: "Yes, archive" }).click();
  const archivedAgain = page
    .getByTestId("archived-section")
    .locator("div")
    .filter({ hasText: "Renamed board" })
    .last();
  await archivedAgain.getByRole("button", { name: "Delete board" }).click();
  await archivedAgain.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByTestId("archived-section")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(page.getByText("Renamed board")).toHaveCount(0);
});
