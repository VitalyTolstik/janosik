import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/data.js";
import { createExtraBoard } from "@/helpers/boards.js";
import {
  expectBoardInSwitcher,
  exportJsonFromMenu,
  expectToast,
} from "@/helpers/data.js";

test("downloads the workspace as a named Janosik envelope", async ({
  page,
  board,
}) => {
  await board.open(page);

  const exported = await exportJsonFromMenu(page);

  expect(exported.filename).toBe("janosik-boards.json");
  expect(exported.envelope.app).toBe("janosik");
  expect(exported.envelope.schemaVersion).toBe(3);
  expect(Number.isInteger(exported.envelope.exportedAt)).toBe(true);
  expect(exported.envelope.boards.map((entry) => entry.id)).toContain(board.id);
});

test("exports the columns, cards and labels of a board", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Exported column");
  await board.card(columnId, "Exported card");
  await board.label("Exported label");
  await board.open(page);

  const exported = await exportJsonFromMenu(page);
  const exportedBoard = exported.envelope.boards.find(
    (entry) => entry.id === board.id,
  );

  expect(exportedBoard).toBeDefined();
  expect(exportedBoard?.columns.map((column) => column.title)).toContain(
    "Exported column",
  );
  expect(
    Object.values(exportedBoard?.cards ?? {}).map((card) => card.title),
  ).toContain("Exported card");
  expect(exportedBoard?.labels.map((label) => label.name)).toContain(
    "Exported label",
  );
});

test("exports every board of the workspace", async ({ page, board }) => {
  const extra = await createExtraBoard(
    board.api,
    `Second board ${randomUUID()}`,
  );
  await board.open(page);
  await expectBoardInSwitcher(page, extra.title);

  const exported = await exportJsonFromMenu(page);
  const ids = exported.envelope.boards.map((entry) => entry.id);

  expect(ids).toEqual(expect.arrayContaining([board.id, extra.id]));
});

test("exports column accents and the board column style", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Styled column");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId,
    accent: { type: "color", value: "pink" },
  });
  await board.command({ type: "SET_BOARD_COLUMN_STYLE", columnStyle: "band" });
  await board.open(page);

  const exported = await exportJsonFromMenu(page);
  const exportedBoard = exported.envelope.boards.find(
    (entry) => entry.id === board.id,
  );
  expect(exportedBoard?.columnStyle).toBe("band");
  expect(
    exportedBoard?.columns.find((column) => column.id === columnId)?.accent,
  ).toEqual({ type: "color", value: "pink" });
});

test("reports a successful export", async ({ page, board }) => {
  await board.open(page);

  await exportJsonFromMenu(page);

  await expectToast(page, "Board exported");
});
