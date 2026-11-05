import { test, expect } from "../../../fixtures/board.js";

test("edit description, labels, due date, assignee and linked cards", async ({
  page,
  board,
}) => {
  const column = await board.column("Tasks");
  await board.card(column, "Main task");
  await board.card(column, "Related task");
  await board.open(page);
  await page.getByTestId("card-title").filter({ hasText: "Main task" }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  const description = dialog
    .locator("section")
    .filter({ has: page.getByTestId("card-description-toggle") })
    .locator('[contenteditable="true"]');
  await description.fill("A detailed description");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("button", { name: "New label" }).click();
  await page.getByPlaceholder("Label name").fill("Important");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: "Important" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(
    dialog.getByText("Important", { exact: true }).first(),
  ).toBeVisible();
  await dialog.getByTestId("due-date-trigger").click();
  await page.locator('[data-slot="calendar"] button[data-day]').nth(15).click();
  await expect(page.getByTestId("due-date-remove")).toBeVisible();
  await dialog.getByTestId("due-date-trigger").click();
  await dialog.getByTestId("card-assignee-trigger").click();
  await page.locator('[data-testid^="card-assignee-option-"]').first().click();
  await expect(dialog.getByTestId("card-assignee-trigger")).not.toContainText(
    "Unassigned",
  );
  await expect(dialog.getByTestId("card-links")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Link card" }).click();
  await dialog.getByTestId("card-links-input").fill("Related task");
  await dialog.getByTestId("card-links-suggestion").click();
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Related task",
  );
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.reload();
  await page.getByTestId("card-title").filter({ hasText: "Main task" }).click();
  await expect(description).toContainText("A detailed description");
  await expect(
    dialog.getByText("Important", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByTestId("due-date-trigger")).not.toContainText(
    "Set due date",
  );
  await expect(dialog.getByTestId("card-assignee-trigger")).not.toContainText(
    "Unassigned",
  );
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Related task",
  );
});
