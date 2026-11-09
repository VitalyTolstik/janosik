import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/data.js";
import {
  chooseImportFile,
  expectBoardInSwitcher,
  expectToast,
  exportJsonFromMenu,
  openBoardFromSwitcher,
} from "@/helpers/data.js";

test("adds the imported board to the server and the switcher", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard({
    columns: ["Todo"],
    cards: [{ column: "Todo", title: "Imported card" }],
  });
  await board.open(page);

  await chooseImportFile(page, importable.file);

  await expectToast(page, "Board imported");
  await expectBoardInSwitcher(page, importable.title);
  const summaries = await data.listBoards();
  expect(summaries.map((entry) => entry.title)).toContain(importable.title);
});

test("keeps the existing boards when importing", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard();
  await board.open(page);

  await chooseImportFile(page, importable.file);

  await expectToast(page, "Board imported");
  const summaries = await data.listBoards();
  expect(summaries.map((entry) => entry.title)).toEqual(
    expect.arrayContaining([board.title, importable.title]),
  );
});

test("imports every board from a multi-board file", async ({
  page,
  board,
  data,
}) => {
  const first = await data.importableBoard();
  const second = await data.importableBoard();
  const file = data.importFile([
    ...first.envelope.boards,
    ...second.envelope.boards,
  ]);
  await board.open(page);

  await chooseImportFile(page, file);

  await expectToast(page, "Board imported");
  await expectBoardInSwitcher(page, first.title);
  await expectBoardInSwitcher(page, second.title);
  const summaries = await data.listBoards();
  const titles = summaries.map((entry) => entry.title);
  expect(titles).toEqual(expect.arrayContaining([first.title, second.title]));
});

test("preserves the imported board content", async ({ page, board, data }) => {
  const importable = await data.importableBoard({
    columns: ["Backlog", "Done"],
    cards: [{ column: "Backlog", title: "Imported card" }],
    labels: ["Imported label"],
  });
  await board.open(page);

  await chooseImportFile(page, importable.file);

  await expectToast(page, "Board imported");
  const summaries = await data.listBoards();
  const importedSummary = summaries.find(
    (entry) => entry.title === importable.title,
  );
  expect(importedSummary).toBeDefined();
  const imported = await data.exportBoard(importedSummary!.id);
  const importedBoard = imported.boards[0];
  expect(importedBoard.columns.map((column) => column.title)).toEqual([
    "Backlog",
    "Done",
  ]);
  expect(
    Object.values(importedBoard.cards).map((card) => card.title),
  ).toContain("Imported card");
  expect(importedBoard.labels.map((label) => label.name)).toContain(
    "Imported label",
  );
});

test("keeps the imported board after a reload", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard();
  await board.open(page);

  await chooseImportFile(page, importable.file);

  await expectToast(page, "Board imported");
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expectBoardInSwitcher(page, importable.title);
});

test("opens an imported board from the switcher", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard({
    columns: ["Imported column"],
  });
  await board.open(page);

  await chooseImportFile(page, importable.file);

  await expectToast(page, "Board imported");
  await openBoardFromSwitcher(page, importable.title);
  await expect(page.getByText("Imported column")).toBeVisible();
});

test("round-trips a workspace exported through the UI", async ({
  page,
  board,
  data,
}) => {
  const columnId = await board.column("Round-trip column");
  await board.card(columnId, "Round-trip card");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId,
    accent: { type: "gradient", value: "forest" },
  });
  await board.command({ type: "SET_BOARD_COLUMN_STYLE", columnStyle: "glass" });
  await board.open(page);
  const exported = await exportJsonFromMenu(page);
  const title = `Round-trip ${randomUUID().slice(0, 8)}`;
  exported.envelope.boards[0].title = title;

  const exportedColumn = exported.envelope.boards[0].columns.find(
    (column) => column.title === "Round-trip column",
  );
  expect(exportedColumn?.accent).toEqual({
    type: "gradient",
    value: "forest",
  });
  expect(exported.envelope.boards[0].columnStyle).toBe("glass");

  await chooseImportFile(page, data.fileFromEnvelope(exported.envelope));

  await expectToast(page, "Board imported");
  await expectBoardInSwitcher(page, title);
  const summaries = await data.listBoards();
  const importedSummary = summaries.find((entry) => entry.title === title);
  expect(importedSummary).toBeDefined();
  const imported = await data.exportBoard(importedSummary!.id);
  expect(imported.boards[0].columns.map((column) => column.title)).toContain(
    "Round-trip column",
  );
  expect(
    Object.values(imported.boards[0].cards).map((card) => card.title),
  ).toContain("Round-trip card");
  expect(imported.boards[0].columnStyle).toBe("glass");
  expect(
    imported.boards[0].columns.find(
      (column) => column.title === "Round-trip column",
    )?.accent,
  ).toEqual({ type: "gradient", value: "forest" });
});
