import { randomUUID } from "node:crypto";

import { test, expect } from "../../../fixtures/board.js";
import { openMembers, openShare } from "@/helpers/header.js";

/**
 * A roster/share dialog belongs to the board that opened it. Archiving that
 * board switches the app to another one; a stale open flag would otherwise
 * retarget the dialog at the next board's members or share surface.
 */

async function createNextBoard(board: {
  api: import("@playwright/test").APIRequestContext;
}): Promise<{ id: string; title: string }> {
  const title = `Next board ${randomUUID()}`;
  const created = await board.api.post("/api/v1/boards", {
    data: { title },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return { id, title };
}

for (const [label, openDialog, dialogLocator] of [
  [
    "Members",
    openMembers,
    (page: import("@playwright/test").Page) =>
      page.getByTestId("board-members-box"),
  ],
  [
    "Share",
    openShare,
    (page: import("@playwright/test").Page) =>
      page.getByRole("dialog", { name: "Share this board" }),
  ],
] as const) {
  test(`a ${label} dialog does not retarget the next board after archive`, async ({
    page,
    board,
  }) => {
    const next = await createNextBoard(board);
    await board.open(page);

    const dialog = await openDialog(page);
    await expect(dialog).toBeVisible();

    await board.command({ type: "ARCHIVE_BOARD" });

    await expect(page).toHaveURL(new RegExp(`/board/${next.id}(?:$|[?#])`), {
      timeout: 15_000,
    });
    await expect(page.getByTestId("board-title")).toHaveText(next.title);

    // V2 observed the stale dialog still showing the next board after 5 s.
    await page.waitForTimeout(5_500);
    await expect(dialogLocator(page)).toHaveCount(0);
    await expect(page.getByTestId("board-members-box")).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Share this board" }),
    ).toHaveCount(0);
  });
}
