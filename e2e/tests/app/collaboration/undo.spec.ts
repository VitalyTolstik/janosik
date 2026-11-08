import { type Page } from "@playwright/test";
import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence } from "@/helpers/collaboration.js";
import {
  cardDialog,
  cardTitle,
  closeCardDialog,
  expectHistory,
  notification,
  openCard,
  pressUndo,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

const FOREIGN_SKIP = "Another member changed this — undo was skipped";

async function saveTitle(
  page: Page,
  boardId: string,
  from: string,
  to: string,
): Promise<void> {
  await openCard(page, from);
  await cardDialog(page).getByRole("textbox", { name: "Title" }).fill(to);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${boardId}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { title?: string } })
        .action?.title === to,
  );
  await closeCardDialog(page);
  await saved;
  await expect(cardTitle(page, to)).toBeVisible({ timeout: 15_000 });
}

test("undo does not overwrite an edit made in another Chrome context", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Shared task");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await saveTitle(page, board.id, "Shared task", "Owner title");
  await saveTitle(
    partnerBrowser.page,
    board.id,
    "Owner title",
    "Partner title",
  );
  await expect(cardTitle(page, "Partner title")).toBeVisible({
    timeout: 15_000,
  });

  await pressUndo(page);

  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(cardTitle(page, "Partner title")).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });

  // The server kept the other member's title: undo was skipped, not just
  // hidden by the local UI.
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title?: string }>;
  };
  expect(aggregate.cards[cardId].title).toBe("Partner title");
});
