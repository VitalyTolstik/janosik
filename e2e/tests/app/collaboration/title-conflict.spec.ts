import { type Locator, type Page } from "@playwright/test";

import {
  test,
  expect,
  type CollaborationRole,
} from "@/fixtures/collaboration.js";
import type { BoardFixture } from "@/fixtures/board.js";
import { expectPresence } from "@/helpers/collaboration.js";
import {
  cardDialog,
  cardTitle,
  cardTitleInput,
  closeCardDialog,
  openCard,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

type Partner = {
  invite: (role?: CollaborationRole, expiresAt?: string) => Promise<void>;
  accept: () => Promise<void>;
};

async function sharedCard(board: BoardFixture, partner: Partner) {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Shared card");
  await partner.invite("MEMBER");
  await partner.accept();
  return cardId;
}

/**
 * A card title commits after a 400 ms idle gap. A test that races an API
 * command against that timer is flaky by construction, so the page clock is
 * paused after the dialog opens: the local draft stays pending until the
 * user resolves the banner, exactly like a slow typist would leave it.
 */
async function openPendingTitle(
  partnerBrowser: Page,
  cardId: string,
  ownerBoard: BoardFixture,
): Promise<Locator> {
  await openCard(partnerBrowser, "Shared card");
  await partnerBrowser.clock.install();
  await partnerBrowser.clock.pauseAt(new Date());
  const input = cardTitleInput(partnerBrowser);
  await input.fill("Mine");
  await expect(input).toHaveValue("Mine");

  await ownerBoard.command({
    type: "UPDATE_CARD",
    cardId,
    title: "Theirs",
  });
  const conflict = cardDialog(partnerBrowser).getByTestId(
    "card-title-conflict",
  );
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(input).toHaveValue("Mine");
  return conflict;
}

test("a title conflict keeps my draft when I choose Keep", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const cardId = await sharedCard(board, partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);
  const conflict = await openPendingTitle(partnerBrowser.page, cardId, board);

  const saved = partnerBrowser.page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (
        response.request().postDataJSON() as {
          action?: { type?: string; title?: string };
        }
      ).action?.type === "UPDATE_CARD" &&
      (
        response.request().postDataJSON() as {
          action?: { title?: string };
        }
      ).action?.title === "Mine",
  );
  await conflict.getByTestId("card-title-conflict-keep").click();
  await saved;
  await expect(conflict).toBeHidden();

  await closeCardDialog(partnerBrowser.page);
  await expect(cardTitle(partnerBrowser.page, "Mine")).toBeVisible({
    timeout: 15_000,
  });
  await expect(cardTitle(partnerBrowser.page, "Theirs")).toHaveCount(0);

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title?: string }>;
  };
  expect(aggregate.cards[cardId].title).toBe("Mine");
});

test("a title conflict discards my draft when I choose Reload", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const cardId = await sharedCard(board, partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  const writes: string[] = [];
  partnerBrowser.page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/boards/${board.id}/commands`)
    ) {
      const action = (request.postDataJSON() as { action?: { title?: string } })
        .action;
      if (action?.title !== undefined) writes.push(action.title);
    }
  });

  const conflict = await openPendingTitle(partnerBrowser.page, cardId, board);
  await conflict.getByTestId("card-title-conflict-reload").click();
  await expect(conflict).toBeHidden();
  await expect(cardTitleInput(partnerBrowser.page)).toHaveValue("Theirs");
  // The local 400 ms timer was cancelled by the conflict; a paused clock
  // would hide a stray commit, so the write log is the real assertion.
  await partnerBrowser.page.waitForTimeout(500);
  expect(writes).toEqual([]);

  await closeCardDialog(partnerBrowser.page);
  await expect(cardTitle(partnerBrowser.page, "Theirs")).toBeVisible({
    timeout: 15_000,
  });

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title?: string }>;
  };
  expect(aggregate.cards[cardId].title).toBe("Theirs");
});
