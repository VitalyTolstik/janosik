import { test, expect } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";
import { dragCard, hoverCardOverColumn } from "@/helpers/workflow.js";

function workflow(backlog: string, doing: string, done: string) {
  return {
    schemaVersion: 1,
    enabled: true,
    initialColumnId: backlog,
    doneColumnIds: [done],
    transitions: [
      { id: "backlog-doing", fromColumnId: backlog, toColumnId: doing },
      { id: "doing-backlog", fromColumnId: doing, toColumnId: backlog },
    ],
  };
}

test("an allowed drag moves the card", async ({ page, board }) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Allowed move");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: workflow(backlog, doing, done),
  });
  await board.open(page);

  await dragCard(page, "Backlog", "Allowed move", "Doing");
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Allowed move");
  await expect(
    columnSection(page, "Backlog").getByTestId("card-title"),
  ).toHaveCount(0);
});

test("a blocked drag leaves the card and explains why", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Blocked move");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: workflow(backlog, doing, done),
  });
  await board.open(page);

  await hoverCardOverColumn(page, "Blocked move", "Done");
  // The forbidden column stays visible and disabled, with the reason.
  await expect(
    page.getByTestId(`column-workflow-blocked-${done}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`column-workflow-blocked-${done}`),
  ).toContainText("Backlog → Done");
  await page.mouse.up();

  await expect(
    page.locator(".janosik-toast").filter({ hasText: "Backlog → Done" }),
  ).toBeVisible();
  await expect(
    columnSection(page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Blocked move");
  await expect(
    columnSection(page, "Done").getByTestId("card-title"),
  ).toHaveCount(0);
});

test("dragging inside the source column is still sorting", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "First");
  await board.card(backlog, "Second");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: workflow(backlog, doing, done),
  });
  await board.open(page);

  // Sorting inside the source column never leaves it, even with control on.
  await dragCard(page, "Backlog", "First", "Backlog");
  await expect(
    columnSection(page, "Backlog").getByTestId("card-title"),
  ).toHaveCount(2);
  await expect(
    columnSection(page, "Backlog")
      .getByTestId("card-title")
      .filter({ hasText: "First" })
      .first(),
  ).toBeVisible();
});
