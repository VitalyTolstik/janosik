import { test, expect } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";

test("disables adding and duplicating at the column cap", async ({
  page,
  board,
}) => {
  for (let index = 0; index < 12; index += 1) {
    await board.column(`Column ${index + 1}`);
  }
  await board.open(page);
  await expect(page.locator('section > header[role="group"]')).toHaveCount(12);

  const add = page.getByRole("button", { name: "Add column", exact: true });
  await expect(add).toBeDisabled();
  await add.locator("..").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Column limit reached (12)",
  );

  await columnSection(page, "Column 1")
    .getByRole("button", { name: "Column options" })
    .click();
  const duplicate = page.getByRole("menuitem", {
    name: "Duplicate column",
    exact: true,
  });
  await expect(duplicate).toHaveAttribute("title", "Column limit reached (12)");
  await expect(duplicate).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.locator('section > header[role="group"]')).toHaveCount(12);
  await expect(
    page.getByRole("button", { name: "Add column", exact: true }),
  ).toBeDisabled();
});
