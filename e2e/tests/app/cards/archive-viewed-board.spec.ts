import { randomUUID } from "node:crypto";

import { type APIRequestContext, type Page } from "@playwright/test";

import { test, expect } from "@/fixtures/board.js";
import { appUrl } from "@/helpers/urls.js";

/**
 * F1: a card deep link onto an archived board views that archived board
 * without activating it. The data menu's archive must follow the route board
 * (read-only, no restore/delete) instead of silently opening the active
 * board's archive.
 */

async function command(
  api: APIRequestContext,
  boardId: string,
  action: Record<string, unknown>,
) {
  const response = await api.post(`/api/v1/boards/${boardId}/commands`, {
    data: {
      commandId: randomUUID(),
      action: { boardId, at: Date.now(), ...action },
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * The card dialog is modal, so header chrome is behind its aria-hidden
 * ancestor. The review found this path through the DOM; open the data menu
 * the same way to exercise the archive dialog on the archived deep link.
 */
async function openArchiveBehindCardDialog(page: Page) {
  // The header is aria-hidden behind the modal, so role queries cannot see
  // the trigger; locate it by attribute like the review did.
  const trigger = page.locator('button[aria-label="Data & backups"]');
  await expect(trigger).toHaveCount(1);
  await trigger.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    (element as HTMLElement).click();
  });
  const archiveItem = page.getByTestId("data-archive");
  await expect(archiveItem).toBeVisible();
  await archiveItem.evaluate((element) => (element as HTMLElement).click());
  return page.getByRole("dialog", { name: "Card archive" });
}

for (const width of [390, 768]) {
  test(`archives the viewed board from an archived card deep link at ${width}px`, async ({
    page,
    board,
  }) => {
    const archivedTitle = `Archived route ${randomUUID()}`;
    const created = await board.api.post("/api/v1/boards", {
      data: { title: archivedTitle },
    });
    expect(created.status()).toBe(201);
    const { id: archivedId } = (await created.json()) as { id: string };

    const columnId = randomUUID();
    await command(board.api, archivedId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    const cardId = randomUUID();
    await command(board.api, archivedId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Archived deep-link card",
    });
    await command(board.api, archivedId, { type: "ARCHIVE_BOARD" });

    await page.setViewportSize({ width, height: 1024 });
    await board.open(page);
    await page.goto(new URL(`board/${archivedId}?card=${cardId}`, appUrl).href);
    await expect(page).toHaveURL(new RegExp(archivedId));

    const cardDialog = page.getByRole("dialog", { name: "Card details" });
    await expect(cardDialog).toBeVisible();
    await expect(cardDialog.getByTestId("archived-board-notice")).toBeVisible();
    // The Members trigger used to render behind this dialog's inert header.
    await expect(page.locator('button[aria-label="Members"]')).toHaveCount(0);

    const archiveDialog = await openArchiveBehindCardDialog(page);
    await expect(archiveDialog).toBeVisible();
    await expect(archiveDialog).toContainText(archivedTitle);
    await expect(archiveDialog).not.toContainText(board.title);
    await expect(
      archiveDialog.getByTestId("archived-board-notice"),
    ).toBeVisible();
    await expect(archiveDialog.getByTestId("archive-restore")).toHaveCount(0);
    await expect(archiveDialog.getByTestId("archive-delete")).toHaveCount(0);
    await expect(
      archiveDialog.getByTestId("archive-bulk-controls"),
    ).toHaveCount(0);
  });
}
