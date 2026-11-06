import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";
import {
  cardByTitle,
  clearSearchWithButton,
  expectCardTitles,
  filterBar,
  search,
  searchInput,
} from "@/helpers/filters.js";

test("filters cards by a case-insensitive title substring", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  await board.card(todo, "Buy milk");
  await board.card(todo, "Bail bread");
  await board.card(doing, "Buy bread");
  await board.card(doing, "Sell chair");
  await board.open(page);

  await search(page, "BUY");

  await expectCardTitles(page, ["Buy milk", "Buy bread"]);
  await expect(filterBar(page).getByText("2 cards found")).toBeVisible();
});

test("filters cards by description and marks the description badge", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const described = await board.card(todo, "Tidy up");
  await board.command({
    type: "UPDATE_CARD",
    cardId: described,
    description: "Under the sofa there is a cable",
  });
  await board.card(todo, "Other task");
  await board.open(page);

  await search(page, "sofa");

  await expectCardTitles(page, ["Tidy up"]);
  await expect(
    cardByTitle(page, "Tidy up").getByTestId("card-description-badge"),
  ).toHaveAttribute("data-highlight", "description");
});

test("filters cards by label name", async ({ page, board }) => {
  const todo = await board.column("Todo");
  const design = await board.label("Design", "blue");
  const backend = await board.label("Backend", "green");
  const designCard = await board.card(todo, "Landing page");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: designCard,
    labelId: design,
    on: true,
  });
  const backendCard = await board.card(todo, "API endpoint");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: backendCard,
    labelId: backend,
    on: true,
  });
  await board.open(page);

  await search(page, "desig");

  await expectCardTitles(page, ["Landing page"]);
  await expect(
    cardByTitle(page, "Landing page").getByText("Design", { exact: true }),
  ).toBeVisible();
});

test("filters cards by checklist item text without marking the description badge", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const release = await board.card(todo, "Release");
  await board.command({
    type: "UPDATE_CARD",
    cardId: release,
    description: "Long release notes live here",
  });
  const checklistId = randomUUID();
  await board.command({
    type: "ADD_CHECKLIST",
    cardId: release,
    newChecklistId: checklistId,
    title: "DoD",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId: release,
    checklistId,
    newItemId: randomUUID(),
    text: "run the widget migration",
  });
  await board.card(todo, "Unrelated");
  await board.open(page);

  await search(page, "widget migration");

  await expectCardTitles(page, ["Release"]);
  await expect(
    cardByTitle(page, "Release").getByTestId("card-description-badge"),
  ).not.toHaveAttribute("data-highlight", "description");
});

test("clears the search query with the input button", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.card(todo, "Sell chair");
  await board.open(page);

  await search(page, "Buy");
  await expectCardTitles(page, ["Buy milk"]);

  await clearSearchWithButton(page);

  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Buy milk", "Sell chair"]);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
});

test("focuses the search with slash and clears it with Escape", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.card(todo, "Sell chair");
  await board.open(page);

  await page.keyboard.press("/");
  await expect(searchInput(page)).toBeFocused();
  await page.keyboard.type("Buy");
  await expectCardTitles(page, ["Buy milk"]);

  await page.keyboard.press("Escape");
  await expect(searchInput(page)).toHaveValue("");
  await expect(searchInput(page)).toBeFocused();
  await expectCardTitles(page, ["Buy milk", "Sell chair"]);

  await page.keyboard.press("Escape");
  await expect(searchInput(page)).not.toBeFocused();
});

test("counts the matching cards", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.card(todo, "Buy bread");
  await board.card(todo, "Sell chair");
  await board.open(page);

  await search(page, "Buy");
  await expect(filterBar(page).getByText("2 cards found")).toBeVisible();

  await search(page, "Buy milk");
  await expect(filterBar(page).getByText("1 card found")).toBeVisible();

  await clearSearchWithButton(page);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
});

test("highlights the matching part of a card title", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.open(page);

  await search(page, "MILK");

  const title = page.getByTestId("card-title").filter({ hasText: "Buy milk" });
  await expect(title.locator("mark")).toHaveText("milk");
});

test("shows the filter empty state in a column", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.open(page);

  await search(page, "nothing-matches");

  await expect(filterBar(page).getByText("0 cards found")).toBeVisible();
  await expect(page.getByText("No cards match the filter")).toBeVisible();
});
