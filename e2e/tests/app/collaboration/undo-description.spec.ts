import { test, expect } from "@/fixtures/member.js";
import {
  closeCardDialog,
  descriptionEditor,
  expectHistory,
  notification,
  openCard,
  pressUndo,
} from "@/helpers/history.js";

const FOREIGN_SKIP = "Another member changed this — undo was skipped";

test("undo does not overwrite a description edited by another member", async ({
  page,
  board,
  member,
}) => {
  const column = await board.column("Todo");
  const cardId = await board.card(column, "Shared task");
  await board.open(page);

  await openCard(page, "Shared task");
  const editor = descriptionEditor(page);
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.fill("Local description");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (
        response.request().postDataJSON() as {
          action?: { type?: string; description?: string };
        }
      ).action?.type === "UPDATE_CARD" &&
      (
        response.request().postDataJSON() as {
          action?: { description?: string };
        }
      ).action?.description === "Local description",
  );
  await closeCardDialog(page);
  await saved;
  await expectHistory(page, { undo: true, redo: false });

  await member.command({
    type: "UPDATE_CARD",
    cardId,
    description: "Member description",
  });
  // The card face does not show the description: wait for the aggregate so
  // undo cannot race the foreign command's SSE delivery.
  await expect
    .poll(async () => {
      const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
      const aggregate = (await snapshot.json()) as {
        cards: Record<string, { description?: string }>;
      };
      return aggregate.cards[cardId].description;
    })
    .toBe("Member description");

  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { description?: string }>;
  };
  expect(aggregate.cards[cardId].description).toBe("Member description");

  await openCard(page, "Shared task");
  await expect(descriptionEditor(page)).toHaveText("Member description");
});
