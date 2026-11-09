import { test, expect } from "@/fixtures/board.js";
import { cardDialog, openCard } from "@/helpers/history.js";

test("submits with Ctrl+Enter and clears the draft with Cancel", async ({
  page,
  board,
}) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Composer");
  await board.open(page);
  await openCard(page, "Composer");
  const dialog = cardDialog(page);
  const editor = dialog
    .getByTestId("comment-input")
    .locator('[contenteditable="true"]');

  await editor.fill("Sent with the keyboard");
  await editor.press("Control+Enter");
  await expect(dialog.getByTestId("comment-list")).toContainText(
    "Sent with the keyboard",
  );

  const cleared = dialog
    .getByTestId("comment-input")
    .locator('[contenteditable="true"]');
  await cleared.fill("Discard this draft");
  await dialog.getByTestId("comment-cancel").click();
  await expect(
    dialog.getByTestId("comment-input").locator('[contenteditable="true"]'),
  ).toHaveText("");
  await expect(dialog.getByTestId("comment-list")).not.toContainText(
    "Discard this draft",
  );

  const comments = await board.api.get(`/api/v1/cards/${cardId}/comments`);
  expect(comments.ok()).toBeTruthy();
  const body = (await comments.json()) as { items: { text: string }[] };
  expect(body.items.map((item) => item.text)).toEqual([
    "Sent with the keyboard",
  ]);
});

test("labels a comment with the chosen kind", async ({ page, board }) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Typed comment");
  await board.open(page);
  await openCard(page, "Typed comment");
  const dialog = cardDialog(page);

  await dialog
    .getByTestId("comment-input")
    .locator('[contenteditable="true"]')
    .fill("Stuck on the schema");
  await dialog.getByTestId("comment-kind").click();
  // The kind menu is portaled to the body, outside the dialog subtree.
  await page.getByTestId("comment-kind-option-blocker").click();
  await expect(dialog.getByTestId("comment-kind")).toContainText("Blocker");
  await dialog.getByTestId("comment-send").click();

  await expect(dialog.getByTestId("comment-list")).toContainText(
    "Stuck on the schema",
  );
  await expect(dialog.getByTestId("comment-kind-badge")).toContainText(
    /blocker/i,
  );

  const comments = await board.api.get(`/api/v1/cards/${cardId}/comments`);
  expect(comments.ok()).toBeTruthy();
  const body = (await comments.json()) as {
    items: { text: string; kind: string }[];
  };
  expect(body.items[0]).toMatchObject({
    text: "Stuck on the schema",
    kind: "blocker",
  });
});
