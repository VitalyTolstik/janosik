import { test, expect } from "@/fixtures/board.js";
import { columnSection, cardDialog } from "@/helpers/history.js";

test("the card dialog column picker follows the workflow", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Dialog task");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        { id: "backlog-doing", fromColumnId: backlog, toColumnId: doing },
      ],
    },
  });
  await board.open(page);

  await page.getByTestId("card-title").first().click();
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Backlog" }).click();
  await expect(page.getByTestId(`card-dialog-move-${done}`)).toBeDisabled();
  await expect(
    page.getByTestId(`card-dialog-move-reason-${done}`),
  ).toContainText("Backlog → Done");
  await page.getByTestId(`card-dialog-move-${doing}`).click();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Dialog task");
});
