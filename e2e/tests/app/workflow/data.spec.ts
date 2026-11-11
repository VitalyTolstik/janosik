import { test, expect } from "@/fixtures/data.js";
import { chooseImportFile, expectToast } from "@/helpers/data.js";
import { openBoardSettings, showWorkflowMatrix } from "@/helpers/workflow.js";
import { appUrl } from "@/helpers/urls.js";

function workflow(backlog: string, doing: string, done: string) {
  return {
    schemaVersion: 1,
    enabled: true,
    initialColumnId: backlog,
    doneColumnIds: [done],
    transitions: [
      { id: "backlog-doing", fromColumnId: backlog, toColumnId: doing },
    ],
  };
}

test("export and import keep the workflow and remap its columns", async ({
  page,
  board,
  data,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Carried task");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: workflow(backlog, doing, done),
  });

  const exported = await data.exportBoard(board.id);
  expect(exported.schemaVersion).toBe(3);
  expect(exported.boards[0].workflow).toMatchObject({
    enabled: true,
    initialColumnId: backlog,
    doneColumnIds: [done],
  });

  await board.open(page);
  await chooseImportFile(page, data.fileFromEnvelope(exported));
  await expectToast(page, "Board imported");
  const summaries = await data.listBoards();
  const imported = summaries.find(
    (entry) => entry.title === board.title && entry.id !== board.id,
  );
  expect(imported).toBeDefined();
  const importedEnvelope = await data.exportBoard(imported!.id);
  const importedBoard = importedEnvelope.boards[0];
  const importedBacklog = importedBoard.columns.find(
    (column) => column.title === "Backlog",
  )!;
  const importedDoing = importedBoard.columns.find(
    (column) => column.title === "Doing",
  )!;
  const importedWorkflow = importedBoard.workflow as {
    transitions: Array<{ fromColumnId: string; toColumnId: string }>;
  };
  expect(importedWorkflow.transitions[0]).toMatchObject({
    fromColumnId: importedBacklog.id,
    toColumnId: importedDoing.id,
  });

  await page.goto(new URL(`board/${imported!.id}`, appUrl).href);
  await expect(
    page.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  const dialog = await openBoardSettings(page);
  await showWorkflowMatrix(page);
  await expect(
    dialog.getByTestId(
      `workflow-cell-${importedBacklog.id}-${importedDoing.id}`,
    ),
  ).toHaveAttribute("aria-pressed", "true");
});

test("archive and restore keep the workflow", async ({ page, board }) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: workflow(backlog, doing, done),
  });
  await board.open(page);

  await page.getByRole("button", { name: "Switch board" }).click();
  const row = page.getByRole("option").filter({ hasText: board.title }).first();
  await row.hover();
  await row.getByRole("button", { name: "Archive board" }).click();
  await row.getByRole("button", { name: "Yes, archive" }).click();
  await expect(
    page.getByRole("heading", { name: "All boards are archived." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByTestId("archived-section")).toContainText(board.title);

  const archived = page
    .getByTestId("archived-section")
    .locator("div")
    .filter({ hasText: board.title })
    .last();
  await archived.getByRole("button", { name: "Restore board" }).click();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();

  const dialog = await openBoardSettings(page);
  await expect(dialog.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await showWorkflowMatrix(page);
  await expect(
    dialog.getByTestId(`workflow-cell-${backlog}-${doing}`),
  ).toHaveAttribute("aria-pressed", "true");
});
