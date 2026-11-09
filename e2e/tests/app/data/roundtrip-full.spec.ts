import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/data.js";
import {
  chooseImportFile,
  exportJsonFromMenu,
  openBoardFromSwitcher,
} from "@/helpers/data.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";

const DUE = Date.UTC(2027, 0, 15);

test("round-trips full card content and an archived card through the UI", async ({
  page,
  board,
  data,
}) => {
  const column = await board.column("Backlog");
  const cardA = await board.card(column, "Complete A");
  const cardB = await board.card(column, "Target B");
  const cardC = await board.card(column, "Archived C");
  const labelId = await board.label("Bug");
  const checklistId = randomUUID();
  const itemId = randomUUID();
  await board.command({
    type: "UPDATE_CARD",
    cardId: cardA,
    description: "A description that must survive the file",
  });
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: cardA,
    labelId,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: cardA,
    priority: "high",
  });
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: cardA,
    dueDate: DUE,
  });
  await board.command({
    type: "SET_CARD_COVER",
    cardId: cardA,
    cover: { type: "color", value: "blue" },
  });
  await board.command({
    type: "ADD_CHECKLIST",
    cardId: cardA,
    newChecklistId: checklistId,
    title: "Steps",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId: cardA,
    checklistId,
    newItemId: itemId,
    text: "Done item",
  });
  await board.command({
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId: cardA,
    checklistId,
    itemId,
    done: true,
  });
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: cardA,
    linkId: randomUUID(),
    targetCardId: cardB,
    linkType: "relates_to",
  });
  await board.command({ type: "ARCHIVE_CARD", cardId: cardC });

  await board.open(page);
  const exported = await exportJsonFromMenu(page);
  const title = `Round-trip full ${randomUUID().slice(0, 8)}`;
  exported.envelope.boards[0].title = title;
  await chooseImportFile(page, data.fileFromEnvelope(exported.envelope));
  await expect(
    page.getByRole("status").filter({ hasText: "Board imported" }),
  ).toBeVisible();

  const summaries = await data.listBoards();
  const importedSummary = summaries.find((entry) => entry.title === title);
  expect(importedSummary).toBeDefined();
  expect(importedSummary!.id).not.toBe(board.id);
  const imported = await data.exportBoard(importedSummary!.id);
  const importedBoard = imported.boards[0];
  const cards = Object.values(importedBoard.cards);
  const byTitle = new Map(cards.map((card) => [card.title, card]));
  const a = byTitle.get("Complete A")!;
  const b = byTitle.get("Target B")!;
  const c = byTitle.get("Archived C")!;
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(c).toBeDefined();
  expect(a.description).toBe("A description that must survive the file");
  expect(a.priority).toBe("high");
  expect(a.dueDate).toBe(DUE);
  expect(a.cover).toEqual({ type: "color", value: "blue" });
  expect(a.labelIds).toHaveLength(1);
  expect(
    importedBoard.labels.find((label) => label.id === a.labelIds?.[0])?.name,
  ).toBe("Bug");
  expect(a.checklists?.[0].items[0]).toMatchObject({
    text: "Done item",
    done: true,
  });
  expect(a.links?.[0]).toMatchObject({
    type: "relates_to",
    targetCardId: b.id,
  });
  expect(c.archivedAt).toEqual(expect.any(Number));
  expect(importedBoard.columns.flatMap((entry) => entry.cardIds)).not.toContain(
    c.id,
  );

  await openBoardFromSwitcher(page, title);
  await openCard(page, "Complete A");
  const dialog = cardDialog(page);
  await expect(dialog.getByTestId("priority-trigger")).toContainText("High");
  await expect(dialog.getByText("Bug", { exact: true }).first()).toBeVisible();
  await expect(
    dialog.locator("li").filter({ hasText: "Done item" }).first(),
  ).toContainText("Done item");
  await expect(
    dialog
      .locator("li")
      .filter({ hasText: "Done item" })
      .first()
      .getByRole("button", { pressed: true }),
  ).toBeVisible();
  await expect(dialog.getByTestId("card-link-row")).toContainText("Target B");
  await dialog.getByTestId("cover-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
  await dialog.getByTestId("cover-trigger").click();
  await closeCardDialog(page);

  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  await expect(
    page.getByTestId("archive-row").filter({ hasText: "Archived C" }),
  ).toBeVisible();
});
