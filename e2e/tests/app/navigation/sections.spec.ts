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

test("handles switcher search no-match, Escape and ArrowUp", async ({
  page,
  board,
  navigation,
}) => {
  const extra = await createExtraBoard(
    board.api,
    `Newest board ${randomUUID()}`,
  );
  await navigation.signInAt(page, navigation.boardUrl);
  const trigger = page.getByRole("button", { name: "Switch board" });

  await trigger.click();
  const search = page.getByRole("textbox", { name: "Search boards…" });
  await search.fill("no-such-board-name");
  await expect(page.getByText("No boards match")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const reopened = page.getByRole("textbox", { name: "Search boards…" });
  await expect(reopened).toBeFocused();
  const current = page.getByRole("option").filter({ hasText: board.title });
  await expect(current).toHaveAttribute("aria-selected", "true");
  await reopened.fill("board");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  const first = options.first();
  await expect(first).toHaveClass(/bg-hover/);
  const firstText = (await first.textContent()) ?? "";
  const expected = firstText.includes(extra.title) ? extra : board;
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/board/${expected.id}$`));
  await expect(
    page.getByRole("heading", { name: expected.title }),
  ).toBeVisible();
});

test("handles an all-archived workspace and its deep link", async ({
  page,
  board,
  navigation,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The sign-in screen probes `/auth/refresh` before a session exists; its
    // 401 is the expected "no cookie" answer, not a console error.
    if (message.location().url.includes("/auth/refresh")) return;
    errors.push(message.text());
  });
  await board.command({ type: "ARCHIVE_BOARD" });

  await navigation.signInAt(page, appUrl);
  await expect(page.getByText("All boards are archived.")).toBeVisible();
  await expect(page).toHaveURL(appUrl);

  await page.goto(navigation.boardUrl);
  await expect(page.getByText("All boards are archived.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect(page.getByRole("heading", { name: board.title })).toHaveCount(0);
  expect(errors).toEqual([]);
});
