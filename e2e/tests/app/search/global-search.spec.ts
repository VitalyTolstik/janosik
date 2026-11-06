import { test, expect } from "@/fixtures/board.js";
import {
  addChecklistItem,
  archiveBoard,
  archiveCard,
  createSearchBoard,
  globalSearchInput,
  globalSearchOption,
  globalSearchResults,
  globalSearchSection,
  openGlobalSearch,
  searchGlobally,
} from "@/helpers/search.js";

test("opens from the header and focuses the input", async ({ page, board }) => {
  await board.open(page);

  await openGlobalSearch(page);

  await expect(globalSearchInput(page)).toBeFocused();
  await expect(globalSearchResults(page)).toContainText(
    "Type to search titles, descriptions, labels and checklists across all boards.",
  );
});

test("toggles with Ctrl+K and leaves the board search untouched", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Board filtered card");
  await board.open(page);
  const boardSearch = page.locator('input[name="filter-search"]');
  await boardSearch.fill("Board filtered");

  await page.keyboard.press("Control+k");
  await expect(globalSearchInput(page)).toBeVisible();
  await expect(boardSearch).toHaveValue("Board filtered");

  await page.keyboard.press("Control+k");
  await expect(globalSearchInput(page)).toBeHidden();
  await expect(boardSearch).toHaveValue("Board filtered");
});

test("finds a card on another board with a breadcrumb and highlighted title", async ({
  page,
  board,
}) => {
  const other = await createSearchBoard(board.api, "Marketing board");
  const ideas = await other.column("Ideas");
  await other.card(ideas, "Landing redesign");
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "design");

  const hit = globalSearchOption(page, "Landing redesign");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("Marketing board › Ideas");
  await expect(hit.locator("mark")).toHaveText("design");
});

test("finds a card by description and highlights the snippet", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Tidy up");
  await board.command({
    type: "UPDATE_CARD",
    cardId,
    description: "The hero mockups are ready for review",
  });
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "mockups");

  const hit = globalSearchOption(page, "Tidy up");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("The hero mockups are ready for review");
  await expect(hit.locator("mark")).toHaveText("mockups");
});

test("finds a card by label name and shows the label chip", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const design = await board.label("Design", "blue");
  const cardId = await board.card(todo, "Landing page");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId: design,
    on: true,
  });
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "design");

  const hit = globalSearchOption(page, "Landing page");
  await expect(hit).toBeVisible();
  await expect(hit.getByText("Design", { exact: true })).toBeVisible();
});

test("finds a card by a checklist item and shows its text", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Release");
  await addChecklistItem(board.command, cardId, "run the widget migration");
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "widget migration");

  const hit = globalSearchOption(page, "Release");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("run the widget migration");
  await expect(hit.locator("mark")).toHaveText("widget migration");
});

test("groups card hits before board hits", async ({ page, board }) => {
  const other = await createSearchBoard(board.api, "Orion planning");
  const backlog = await other.column("Backlog");
  await other.card(backlog, "Orion roadmap");
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "Orion");

  const sections = globalSearchResults(page).getByRole("listbox");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0)).toHaveAttribute("aria-label", "Cards");
  await expect(sections.nth(1)).toHaveAttribute("aria-label", "Boards");
  await expect(globalSearchSection(page, "Cards")).toContainText(
    "Orion roadmap",
  );
  await expect(globalSearchSection(page, "Boards")).toContainText(
    "Orion planning",
  );
});

test("shows an empty result for a query that matches nothing", async ({
  page,
  board,
}) => {
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "no-such-search-hit");

  await expect(globalSearchResults(page)).toContainText("Nothing found.");
  await expect(globalSearchResults(page).getByRole("option")).toHaveCount(0);
});

test("matches regardless of case and surrounding whitespace", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "  bUy  ");

  const hit = globalSearchOption(page, "Buy milk");
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark")).toHaveText("Buy");
});

test("clears the query when the palette is reopened", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Buy");
  await expect(globalSearchOption(page, "Buy milk")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(globalSearchInput(page)).toBeHidden();

  await openGlobalSearch(page);

  await expect(globalSearchInput(page)).toHaveValue("");
  await expect(globalSearchResults(page)).toContainText(
    "Type to search titles, descriptions, labels and checklists across all boards.",
  );
});

test("caps the result list at 20 hits", async ({ page, board }) => {
  const todo = await board.column("Todo");
  for (let index = 0; index < 21; index += 1) {
    await board.card(todo, `Cap result ${String(index).padStart(2, "0")}`);
  }
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "Cap result");

  await expect(globalSearchResults(page).getByRole("option")).toHaveCount(20);
});

test("opens the card dialog from a search hit", async ({ page, board }) => {
  const other = await createSearchBoard(board.api, "Product board");
  const roadmap = await other.column("Roadmap");
  const cardId = await other.card(roadmap, "Ship release");
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Ship release");

  await globalSearchOption(page, "Ship release").click();

  await expect(page).toHaveURL(
    new RegExp(`/board/${other.id}\\?card=${cardId}`),
  );
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Ship release",
  );
});

test("opens the board from a board-title hit", async ({ page, board }) => {
  const other = await createSearchBoard(board.api, "Research board");
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Research");

  const hit = globalSearchSection(page, "Boards")
    .getByRole("option")
    .filter({ hasText: "Research board" });
  await expect(hit.locator("mark")).toHaveText("Research");
  await hit.click();

  await expect(page).toHaveURL(new RegExp(`/board/${other.id}`));
  await expect(
    page.getByRole("heading", { name: "Research board" }),
  ).toBeVisible();
});

test("moves through results with the arrow keys and opens with Enter", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Keyboard first");
  await board.card(todo, "Keyboard second");
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Keyboard");
  const options = globalSearchResults(page).getByRole("option");
  await expect(options).toHaveCount(2);

  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Keyboard second",
  );
});

test("marks an archived card with the archived badge", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Retro notes");
  await archiveCard(board, cardId);
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "Retro notes");

  const hit = globalSearchOption(page, "Retro notes");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("Archived");
});

test("opens an archived card from an archived board", async ({
  page,
  board,
}) => {
  const archived = await createSearchBoard(board.api, "Old roadmap");
  const done = await archived.column("Done");
  const cardId = await archived.card(done, "Retro notes");
  await archiveCard(archived, cardId);
  await archiveBoard(archived);
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Retro notes");

  const hit = globalSearchOption(page, "Retro notes");
  await expect(hit).toContainText("Old roadmap");
  await expect(hit).toContainText("Archived");
  await hit.click();

  await expect(page).toHaveURL(
    new RegExp(`/board/${archived.id}\\?card=${cardId}`),
  );
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Retro notes",
  );
});

test("scrolls the keyboard selection into view", async ({ page, board }) => {
  const todo = await board.column("Todo");
  for (let index = 0; index < 20; index += 1) {
    await board.card(todo, `Scroll result ${String(index).padStart(2, "0")}`);
  }
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Scroll result");
  const options = globalSearchResults(page).getByRole("option");
  await expect(options).toHaveCount(20);

  for (let index = 0; index < 19; index += 1) {
    await page.keyboard.press("ArrowDown");
  }

  await expect(options.nth(19)).toHaveAttribute("aria-selected", "true");
  await expect(options.nth(19)).toBeInViewport();
});

test("explains that an archived board cannot be opened from search", async ({
  page,
  board,
}) => {
  const archived = await createSearchBoard(board.api, "Archived board");
  await archiveBoard(archived);
  await board.open(page);
  await openGlobalSearch(page);
  await searchGlobally(page, "Archived board");

  await globalSearchSection(page, "Boards")
    .getByRole("option")
    .filter({ hasText: "Archived board" })
    .click();

  await expect(
    page.getByText(
      "This board is archived. Restore it from the board switcher to open it.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}`));
});

test("ranks active boards before archived boards", async ({ page, board }) => {
  const active = await createSearchBoard(board.api, "Rank active");
  const archived = await createSearchBoard(board.api, "Rank archived");
  await archiveBoard(archived);
  await board.open(page);
  await openGlobalSearch(page);

  await searchGlobally(page, "Rank");

  const boards = globalSearchSection(page, "Boards").getByRole("option");
  await expect(boards).toHaveCount(2);
  await expect(boards.nth(0)).toContainText("Rank active");
  await expect(boards.nth(0)).not.toContainText("Archived");
  await expect(boards.nth(1)).toContainText("Rank archived");
  await expect(boards.nth(1)).toContainText("Archived");
});
