import { test, expect } from "../../../fixtures/card-context-menu.js";

test("context menu sets labels, priority, due date, assignee, links and cover", async ({
  page,
  contextCard,
}) => {
  await contextCard.openSubmenu("labels");
  await page.getByTestId("ctx-new-label-name").fill("Menu label");
  await page.getByTestId("ctx-label-create").click();
  await expect(page.getByTestId("ctx-labels-content")).toContainText(
    "Menu label",
  );
  await contextCard.openSubmenu("priority");
  await page.getByTestId("ctx-priority-high").click();
  await contextCard.openSubmenu("due");
  await page
    .getByTestId("ctx-due-content")
    .locator("button[data-day]")
    .nth(15)
    .click();
  await expect(page.getByTestId("due-date-remove")).toBeVisible();
  await contextCard.openSubmenu("assignee");
  await page
    .getByTestId("ctx-assignee-content")
    .getByRole("menuitem")
    .filter({ hasNotText: "Unassigned" })
    .first()
    .click();
  await contextCard.openSubmenu("link");
  await page.getByTestId("ctx-link-search").fill("Related task");
  await page.getByTestId(`ctx-link-target-${contextCard.relatedId}`).click();
  await contextCard.openSubmenu("cover");
  await page.getByTestId("ctx-cover-color-blue").click();
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByTestId("card-title")
    .filter({ hasText: /^Context task$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(
    dialog.getByRole("button", { name: "Menu label" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByTestId("priority-trigger")).toContainText("High");
  await expect(dialog.getByTestId("due-date-trigger")).not.toContainText(
    "Set due date",
  );
  await expect(dialog.getByTestId("card-assignee-trigger")).not.toContainText(
    "Unassigned",
  );
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Related task",
  );
  await dialog.getByTestId("cover-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
});
