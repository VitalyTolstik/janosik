import { test, expect } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";

async function openWipDialog(page: import("@playwright/test").Page) {
  await columnSection(page, "In progress")
    .getByRole("button", { name: "Column options" })
    .click();
  // The menu item carries the current limit in its accessible name
  // ("WIP limit 1"), so match by its prefix.
  await page.getByRole("menuitem", { name: /^WIP limit/ }).click();
}

test("removing the WIP limit unlocks the column", async ({ page, board }) => {
  const id = await board.column("In progress");
  await board.card(id, "Task");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: id,
    wipLimit: 1,
  });
  await board.open(page);
  const column = columnSection(page, "In progress");
  const addCard = () => column.locator("[data-composer-trigger]");
  await expect(column.getByTestId("column-wip")).toHaveText("1/1");
  await expect(addCard()).toBeDisabled();

  await openWipDialog(page);
  await page.getByRole("button", { name: "Remove limit" }).click();
  await expect(column.getByTestId("column-wip")).toHaveText("1");
  await expect(addCard()).toBeEnabled();

  await page.reload();
  await expect
    .poll(() => column.getByTestId("column-wip").textContent())
    .toBe("1");
  await expect(addCard()).toBeEnabled();

  // The empty value is the second route to the same removal.
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: id,
    wipLimit: 1,
  });
  await page.reload();
  await expect
    .poll(() => column.getByTestId("column-wip").textContent())
    .toBe("1/1");
  await openWipDialog(page);
  const input = page.getByRole("textbox", { name: "WIP limit" });
  await input.fill("");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(column.getByTestId("column-wip")).toHaveText("1");
  await expect(addCard()).toBeEnabled();
});
