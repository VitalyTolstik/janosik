import { test, expect } from "../../../fixtures/board.js";
import { type Page } from "@playwright/test";

function column(page: Page, name: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("group", { name, exact: true }) });
}
async function menu(page: Page, name: string, action: string) {
  await column(page, name)
    .getByRole("button", { name: "Column options" })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test("create, rename, reorder, duplicate and delete columns", async ({
  page,
  board,
}) => {
  await board.open(page);
  for (const name of ["First", "Second"]) {
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page.locator('[name="column-create"]').fill(name);
    await page.locator('[name="column-create"]').press("Enter");
    await expect(page.getByRole("group", { name, exact: true })).toBeVisible();
  }
  await menu(page, "First", "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  const source = await page
    .getByRole("group", { name: "Second", exact: true })
    .boundingBox();
  const target = await page
    .getByRole("group", { name: "Renamed", exact: true })
    .boundingBox();
  if (!source || !target) throw new Error("Column headers are not visible");
  await page.mouse.move(source.x + 25, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 15, source.y + source.height / 2, {
    steps: 3,
  });
  await page.mouse.move(target.x + 20, target.y + target.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page
        .locator('section > header[role="group"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
    )
    .toEqual(["Second", "Renamed"]);
  await menu(page, "Renamed", "Duplicate column");
  await expect(
    page.getByRole("group", { name: "Copy of Renamed" }),
  ).toBeVisible();
  await menu(page, "Copy of Renamed", "Delete column");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete column" })
    .click();
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Copy of Renamed" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Renamed", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator('section > header[role="group"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
    )
    .toEqual(["Second", "Renamed"]);
});

test("WIP limit blocks adding cards and bulk archive retains them in archive", async ({
  page,
  board,
}) => {
  const id = await board.column("In progress");
  await board.card(id, "Existing task");
  await board.open(page);
  await menu(page, "In progress", "WIP limit");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "WIP limit" })
    .fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(column(page, "In progress")).toContainText("1/1");
  await expect(
    column(page, "In progress").getByRole("button", {
      name: "Add a card",
      exact: true,
    }),
  ).toBeDisabled();
  await menu(page, "In progress", "Archive all cards");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive all cards" })
    .click();
  await expect(column(page, "In progress")).toContainText("0/1");
  await page.reload();
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  await expect(page.getByTestId("archive-row")).toContainText("Existing task");
});
