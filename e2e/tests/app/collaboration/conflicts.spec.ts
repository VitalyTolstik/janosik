import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence } from "@/helpers/collaboration.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";
import type { Locator, Page } from "@playwright/test";

async function sharedCard(
  board: {
    column: (title: string) => Promise<string>;
    card: (columnId: string, title: string) => Promise<string>;
  },
  partner: {
    invite: (role?: "ADMIN" | "MEMBER" | "VIEWER") => Promise<void>;
    accept: () => Promise<void>;
  },
): Promise<string> {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Shared card");
  await partner.invite("MEMBER");
  await partner.accept();
  return cardId;
}

async function descriptionEditor(page: Page): Promise<Locator> {
  const dialog = cardDialog(page);
  await expect(dialog.locator(".janosik-md-content").first()).toBeVisible({
    timeout: 20_000,
  });
  return dialog;
}

test("a foreign description edit is surfaced instead of silently overwriting it", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const cardId = await sharedCard(board, partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await openCard(partnerBrowser.page, "Shared card");
  const dialog = await descriptionEditor(partnerBrowser.page);
  await dialog.locator(".janosik-md-content").first().fill("Mine");

  await board.command({ type: "UPDATE_CARD", cardId, description: "Theirs" });
  const conflict = dialog.getByTestId("card-description-conflict");
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(conflict).toContainText(
    "Someone else changed this description while you were editing.",
  );

  await closeCardDialog(partnerBrowser.page);
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { description?: string }>;
  };
  expect(aggregate.cards[cardId].description).toBe("Theirs");
});

test("Keep mine resolves the description conflict in my favour", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const cardId = await sharedCard(board, partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await openCard(partnerBrowser.page, "Shared card");
  const dialog = await descriptionEditor(partnerBrowser.page);
  await dialog.locator(".janosik-md-content").first().fill("Mine");

  await board.command({ type: "UPDATE_CARD", cardId, description: "Theirs" });
  const conflict = dialog.getByTestId("card-description-conflict");
  await expect(conflict).toBeVisible({ timeout: 15_000 });

  const saved = partnerBrowser.page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (
        response.request().postDataJSON() as {
          action?: { description?: string };
        }
      ).action?.description === "Mine",
  );
  await conflict.getByTestId("card-description-conflict-keep").click();
  await saved;
  await expect(conflict).toBeHidden();

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { description?: string }>;
  };
  expect(aggregate.cards[cardId].description).toBe("Mine");
});

test("Reload discards my description draft and shows the newer text", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const cardId = await sharedCard(board, partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await openCard(partnerBrowser.page, "Shared card");
  const dialog = await descriptionEditor(partnerBrowser.page);
  const editor = dialog.locator(".janosik-md-content").first();
  await editor.fill("Mine");

  await board.command({ type: "UPDATE_CARD", cardId, description: "Theirs" });
  const conflict = dialog.getByTestId("card-description-conflict");
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await conflict.getByTestId("card-description-conflict-reload").click();

  await expect(conflict).toBeHidden();
  await expect(dialog.locator(".janosik-md-content").first()).toHaveText(
    "Theirs",
  );
  await closeCardDialog(partnerBrowser.page);

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { description?: string }>;
  };
  expect(aggregate.cards[cardId].description).toBe("Theirs");
});
