import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence } from "@/helpers/collaboration.js";
import {
  cardDialog,
  closeCardDialog,
  descriptionEditor,
  openCard,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

test("an unresolved description conflict survives closing and reopening the card", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Shared card");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await openCard(partnerBrowser.page, "Shared card");
  const editor = descriptionEditor(partnerBrowser.page);
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.fill("Mine");

  await board.command({ type: "UPDATE_CARD", cardId, description: "Theirs" });
  const conflict = cardDialog(partnerBrowser.page).getByTestId(
    "card-description-conflict",
  );
  await expect(conflict).toBeVisible({ timeout: 15_000 });

  // Closing does not resolve the conflict: the draft is remembered for the
  // card, not thrown away and not committed behind the other writer.
  await closeCardDialog(partnerBrowser.page);
  await openCard(partnerBrowser.page, "Shared card");
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(descriptionEditor(partnerBrowser.page)).toHaveText("Mine");

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
  await expect(descriptionEditor(partnerBrowser.page)).toHaveText("Mine");

  await closeCardDialog(partnerBrowser.page);
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { description?: string }>;
  };
  expect(aggregate.cards[cardId].description).toBe("Mine");
});
