import { test, expect } from "../../../fixtures/board.js";

test("card details, checklist, attachments, comments and history survive reload", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Detailed task");
  await board.command({
    type: "SET_CARD_TASK_SPEC",
    cardId,
    acceptanceCriteria: ["Acceptance example"],
    definitionOfDone: ["Done example"],
  });
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Detailed task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog.getByTestId("card-task-spec-acceptance")).toContainText(
    "Acceptance example",
  );
  await expect(dialog.getByTestId("card-task-spec-done")).toContainText(
    "Done example",
  );
  await dialog.getByTestId("priority-trigger").click();
  await page.getByTestId("priority-option-high").click();
  await dialog.getByTestId("cover-trigger").click();
  await page.getByRole("radio", { name: "Blue", exact: true }).click();
  await dialog.getByRole("button", { name: "Add checklist" }).click();
  const item = dialog.getByRole("textbox", { name: "Add an item…" });
  await item.fill("Verify work");
  await item.press("Enter");
  await expect(
    dialog.getByText("Verify work", { exact: true }).first(),
  ).toBeVisible();
  const checklistItem = dialog
    .locator("li")
    .filter({ hasText: "Verify work" })
    .first();
  await checklistItem.locator('button[aria-pressed="false"]').click();
  await expect(
    checklistItem.getByRole("button", { pressed: true }),
  ).toBeVisible();
  await dialog.getByTestId("card-attachments-input").setInputFiles({
    name: "proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("proof"),
  });
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "proof.txt",
  );
  await dialog
    .getByTestId("comment-input")
    .locator('[contenteditable="true"]')
    .fill("A useful comment");
  await dialog.getByTestId("comment-send").click();
  await expect(dialog.getByTestId("comment-list")).toContainText(
    "A useful comment",
  );
  await dialog.getByTestId("activity-tab-history").click();
  await expect(dialog.getByTestId("history-entry").first()).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.reload();
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Detailed task" })
    .click();
  await expect(dialog.getByTestId("priority-trigger")).toContainText("High");
  await dialog.getByTestId("cover-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
  await dialog.getByTestId("cover-trigger").click();
  await expect(
    dialog
      .locator("li")
      .filter({ hasText: "Verify work" })
      .first()
      .getByRole("button", { pressed: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Verify work", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "proof.txt",
  );
  await expect(dialog.getByTestId("comment-list")).toContainText(
    "A useful comment",
  );
  await expect(dialog.getByTestId("card-task-spec-acceptance")).toContainText(
    "Acceptance example",
  );
});
