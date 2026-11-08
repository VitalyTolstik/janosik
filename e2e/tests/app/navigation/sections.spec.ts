import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";

import { test, expect } from "@/fixtures/navigation.js";
import { createExtraBoard } from "@/helpers/boards.js";
import { appUrl } from "@/helpers/urls.js";

interface BoardSummary {
  id: string;
  title: string;
  archivedAt?: number | null;
}

/** The board the server lists first among active ones — the home target. */
async function firstActiveBoard(api: APIRequestContext): Promise<BoardSummary> {
  const response = await api.get("/api/v1/boards");
  expect(response.ok()).toBeTruthy();
  const boards = (await response.json()) as BoardSummary[];
  const first = boards.find((entry) => entry.archivedAt == null);
  if (!first) throw new Error("The account has no active board");
  return first;
}

test("redirects the app root to the first active board", async ({
  page,
  board,
  navigation,
}) => {
  await createExtraBoard(board.api, `Newest board ${randomUUID()}`);
  const first = await firstActiveBoard(board.api);

  await navigation.signInAt(page, appUrl);

  await expect(page).toHaveURL(new RegExp(`/board/${first.id}$`));
  await expect(page.getByRole("heading", { name: first.title })).toBeVisible();
});

test("switches boards from the keyboard in the board switcher", async ({
  page,
  board,
  navigation,
}) => {
  await createExtraBoard(board.api, `Newest board ${randomUUID()}`);
  await navigation.signInAt(page, appUrl);
  await page.getByRole("button", { name: "Switch board" }).click();

  const search = page.getByRole("textbox", { name: "Search boards…" });
  await expect(search).toBeFocused();
  await search.fill(board.title);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();
});

test("moves between boards with browser Back and Forward", async ({
  page,
  board,
  navigation,
}) => {
  const newest = await createExtraBoard(
    board.api,
    `Newest board ${randomUUID()}`,
  );
  await navigation.signInAt(page, navigation.boardUrl);
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await page.getByRole("button", { name: "Switch board" }).click();
  await page.getByRole("option").filter({ hasText: newest.title }).click();
  await expect(page).toHaveURL(new RegExp(`/board/${newest.id}$`));

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/board/${newest.id}$`));
  await expect(page.getByRole("heading", { name: newest.title })).toBeVisible();
});

test("shows the all-archived state at the app root", async ({
  page,
  board,
  navigation,
}) => {
  await board.command({ type: "ARCHIVE_BOARD" });

  await navigation.signInAt(page, appUrl);

  await expect(page.getByText("All boards are archived.")).toBeVisible();
  await expect(page).toHaveURL(appUrl);
});
