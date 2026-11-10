import { test, expect } from "@/fixtures/board.js";
import { openTable } from "@/helpers/views.js";

test("the table obeys the same workflow and shows the reason", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Table task");
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
  await openTable(page);

  const row = page.getByRole("row").filter({ hasText: "Table task" });
  await row.getByTestId("table-column-cell").click();
  await expect(page.getByTestId(`table-move-${done}`)).toBeDisabled();
  await expect(page.getByTestId(`table-move-reason-${done}`)).toContainText(
    "Backlog → Done",
  );
  await page.getByTestId(`table-move-${doing}`).click();

  await expect(
    page.getByRole("row").filter({ hasText: "Table task" }),
  ).toContainText("Doing");
});
