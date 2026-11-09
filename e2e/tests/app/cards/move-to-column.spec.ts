import { test, expect } from "@/fixtures/board.js";
import {
  cardDialog,
  cardOrder,
  closeCardDialog,
  openCard,
} from "@/helpers/history.js";

test("moves a card to another column from the dialog", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.column("Doing");
  const full = await board.column("Full");
  await board.card(todo, "Move me");
  await board.card(full, "Occupant");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: full,
    wipLimit: 1,
  });
  await board.open(page);
  await openCard(page, "Move me");
  const dialog = cardDialog(page);

  await dialog.getByRole("button", { name: "Todo", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Full/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();

  await expect(
    dialog.getByRole("button", { name: "Doing", exact: true }),
  ).toBeVisible();
  await closeCardDialog(page);
  expect(await cardOrder(page, "Todo")).toEqual([]);
  expect(await cardOrder(page, "Doing")).toEqual(["Move me"]);
  const place = async (): Promise<string> => {
    const response = await board.api.get(`/api/v1/boards/${board.id}`);
    const aggregate = (await response.json()) as {
      columns: Array<{ title: string; cardIds: string[] }>;
      cards: Record<string, { title: string }>;
    };
    const entry = Object.entries(aggregate.cards).find(
      ([, card]) => card.title === "Move me",
    );
    if (!entry) return "";
    const [id] = entry;
    return (
      aggregate.columns.find((column) => column.cardIds.includes(id))?.title ??
      ""
    );
  };
  await expect.poll(place).toBe("Doing");

  await page.reload();
  await expect.poll(() => cardOrder(page, "Doing")).toEqual(["Move me"]);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual([]);
});
