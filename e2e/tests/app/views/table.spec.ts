import { test, expect } from "@/fixtures/board.js";
import { getBoard } from "@/helpers/boards.js";
import { cardByTitle, resetFilters, search } from "@/helpers/filters.js";
import { openTable, openView, tableRow } from "@/helpers/views.js";

test("create and rename a card in the table and retain it in other views", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await openTable(page);
  await page.getByTestId("table-add-card").click();
  const composer = page.getByTestId("table-composer-input");
  await composer.fill("Table task");
  await composer.press("Enter");
  await page.keyboard.press("Escape");
  const row = tableRow(page, "Table task");
  await expect(row).toBeVisible();
  await row.getByText("Table task", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog
    .getByRole("textbox", { name: "Title" })
    .fill("Renamed table task");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(tableRow(page, "Renamed table task")).toBeVisible();
  await openView(page, "Board");
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Renamed table task" }),
  ).toBeVisible();
  await page.reload();
  await openTable(page);
  await expect(tableRow(page, "Renamed table task")).toBeVisible();
});

test("sets and removes a due date inline and reflects it in the board", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Inline due");
  await board.open(page);
  await openTable(page);
  const row = tableRow(page, "Inline due");
  const dayLabel = await page.evaluate(() => new Date().toLocaleDateString());

  await row.getByTestId("table-due-cell").click();
  await page.locator(`button[data-day="${dayLabel}"]`).click();
  await expect(row.getByTestId("card-due-badge")).toBeVisible();
  await expect
    .poll(
      async () => (await getBoard(board.api, board.id)).cards[cardId]?.dueDate,
    )
    .toBeDefined();
  let due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  const today = new Date();
  expect([
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
    due.getHours(),
    due.getMinutes(),
  ]).toEqual([today.getFullYear(), today.getMonth(), today.getDate(), 12, 0]);

  // Picking a day keeps the popover open; remove right away, then close it.
  await page.getByTestId("due-date-remove").click();
  await expect(row.getByTestId("card-due-badge")).toHaveCount(0);
  await expect
    .poll(
      async () => (await getBoard(board.api, board.id)).cards[cardId]?.dueDate,
    )
    .toBeUndefined();
  await page.keyboard.press("Escape");

  await row.getByTestId("table-due-cell").click();
  await page.locator(`button[data-day="${dayLabel}"]`).click();
  await expect(row.getByTestId("card-due-badge")).toBeVisible();
  await page.keyboard.press("Escape");

  await openView(page, "Board");
  await expect(
    cardByTitle(page, "Inline due").getByTestId("card-due-badge"),
  ).toBeVisible();
  await page.reload();
  await openTable(page);
  await expect(row.getByTestId("card-due-badge")).toBeVisible();
  due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  expect(due.getDate()).toBe(today.getDate());
});

test("edits a title, labels and column inline", async ({ page, board }) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const bug = await board.label("Bug", "red");
  const cardId = await board.card(todo, "Old inline title");
  await board.open(page);
  await openTable(page);
  const row = tableRow(page, "Old inline title");

  await row.getByText("Old inline title", { exact: true }).dblclick();
  const titleInput = page.getByTestId("table-title-input");
  await titleInput.fill("Renamed inline");
  await titleInput.press("Enter");
  const renamed = tableRow(page, "Renamed inline");
  await expect(
    renamed.getByText("Renamed inline", { exact: true }),
  ).toBeVisible();

  await renamed.getByTestId("table-labels-cell").click();
  await page.getByRole("button", { name: "Bug", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(renamed.getByText("Bug", { exact: true })).toBeVisible();

  await renamed.getByTestId("table-column-cell").click();
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
  await expect(renamed.getByTestId("table-column-cell")).toHaveText("Doing");

  await expect
    .poll(async () =>
      (await getBoard(board.api, board.id)).columns
        .find((column) => column.id === doing)
        ?.cardIds.includes(cardId),
    )
    .toBe(true);
  const committed = await getBoard(board.api, board.id);
  expect(committed.cards[cardId]?.title).toBe("Renamed inline");
  expect(committed.cards[cardId]?.labelIds).toContain(bug);
  expect(
    committed.columns.find((column) => column.id === doing)?.cardIds,
  ).toContain(cardId);
  expect(
    committed.columns.find((column) => column.id === todo)?.cardIds,
  ).not.toContain(cardId);

  await openView(page, "Board");
  const doingSection = page
    .locator("section")
    .filter({ has: page.getByRole("group", { name: "Doing", exact: true }) });
  await expect(doingSection.getByTestId("card-title")).toHaveText(
    "Renamed inline",
  );
  await expect(
    cardByTitle(page, "Renamed inline").getByText("Bug", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await openTable(page);
  await expect(tableRow(page, "Renamed inline")).toContainText("Bug");
});

test("sorts by every header asc, desc and back to board order", async ({
  page,
  board,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "janosik-table-columns",
      JSON.stringify(["priority", "assignee", "createdAt"]),
    );
  });
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const alpha = await board.card(doing, "Alpha");
  const bravo = await board.card(backlog, "Bravo");
  const charlie = await board.card(doing, "Charlie");
  await board.card(backlog, "Delta");
  for (const [cardId, offset] of [
    [alpha, day],
    [bravo, 2 * day],
    [charlie, 3 * day],
  ] as const) {
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId,
      dueDate: now + offset,
    });
  }
  for (const [cardId, priority] of [
    [alpha, "low"],
    [bravo, "high"],
    [charlie, "medium"],
  ] as const) {
    await board.command({ type: "SET_CARD_PRIORITY", cardId, priority });
  }
  // Delta has no priority/due/assignee: it exercises the "unset = medium"
  // and "undated last" rules.
  for (const cardId of [alpha, bravo]) {
    await board.command({
      type: "SET_CARD_ASSIGN",
      cardId,
      assigneeId: board.userId,
    });
  }

  await board.open(page);
  await openTable(page);
  const boardOrder = ["Bravo", "Delta", "Alpha", "Charlie"];
  const titles = () =>
    page
      .getByTestId("table-row")
      .evaluateAll((rows) =>
        rows.map((row) => row.querySelector("td")?.textContent ?? ""),
      );
  const header = (key: string) =>
    page.locator("th", { has: page.getByTestId(`table-sort-${key}`) });

  await expect.poll(titles).toEqual(boardOrder);

  const expectations: [string, string[], string[]][] = [
    [
      "title",
      ["Alpha", "Bravo", "Charlie", "Delta"],
      ["Delta", "Charlie", "Bravo", "Alpha"],
    ],
    [
      "column",
      ["Bravo", "Delta", "Alpha", "Charlie"],
      ["Alpha", "Charlie", "Bravo", "Delta"],
    ],
    [
      "due",
      ["Alpha", "Bravo", "Charlie", "Delta"],
      ["Charlie", "Bravo", "Alpha", "Delta"],
    ],
    [
      "priority",
      ["Bravo", "Delta", "Charlie", "Alpha"],
      ["Alpha", "Delta", "Charlie", "Bravo"],
    ],
    [
      "assignee",
      ["Bravo", "Alpha", "Delta", "Charlie"],
      ["Bravo", "Alpha", "Delta", "Charlie"],
    ],
  ];

  for (const [key, ascending, descending] of expectations) {
    const button = page.getByTestId(`table-sort-${key}`);
    await button.click();
    await expect(header(key)).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(titles).toEqual(ascending);
    await button.click();
    await expect(header(key)).toHaveAttribute("aria-sort", "descending");
    await expect.poll(titles).toEqual(descending);
    await button.click();
    await expect(header(key)).toHaveAttribute("aria-sort", "none");
    await expect.poll(titles).toEqual(boardOrder);
  }

  // Creation date is timestampless in assertions: compare asc and desc with
  // each other, then confirm the third click returns the stored board order.
  const created = page.getByTestId("table-sort-createdAt");
  await created.click();
  await expect(header("createdAt")).toHaveAttribute("aria-sort", "ascending");
  const createdAsc = await titles();
  await created.click();
  await expect(header("createdAt")).toHaveAttribute("aria-sort", "descending");
  await expect.poll(titles).toEqual([...createdAsc].reverse());
  await created.click();
  await expect(header("createdAt")).toHaveAttribute("aria-sort", "none");
  await expect.poll(titles).toEqual(boardOrder);
});

test("shows optional columns and remembers the choice", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Detailed card");
  await board.command({
    type: "UPDATE_CARD",
    cardId,
    description: "Has a description",
  });
  await board.open(page);
  await openTable(page);

  await page.getByTestId("table-columns-settings").click();
  await page.getByRole("menuitemcheckbox", { name: "Priority" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Description" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: "Priority", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Description", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("table-priority")).toBeVisible();
  await expect(page.getByTestId("table-description")).toBeVisible();

  await page.reload();
  await openTable(page);
  await expect(
    page.getByRole("columnheader", { name: "Priority", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Description", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Assignee", exact: true }),
  ).toBeVisible();

  await page.getByTestId("table-columns-settings").click();
  await page.getByRole("menuitemcheckbox", { name: "Assignee" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: "Assignee", exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await openTable(page);
  await expect(
    page.getByRole("columnheader", { name: "Assignee", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Priority", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Description", exact: true }),
  ).toBeVisible();
});

test("shows the filtered empty state", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Visible card");
  await board.open(page);
  await search(page, "no-such-card");
  await openTable(page);

  await expect(
    page.getByText("No cards match the filter", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("table-row")).toHaveCount(0);

  await resetFilters(page);

  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await expect(tableRow(page, "Visible card")).toBeVisible();
});
