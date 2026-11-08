import { test, expect } from "@/fixtures/board.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";

test("deletes an own comment after confirmation and it stays deleted", async ({
  page,
  board,
}) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Discuss");
  const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "Please remove me" },
  });
  expect(created.status()).toBe(201);
  await board.open(page);
  await openCard(page, "Discuss");
  const dialog = cardDialog(page);
  const comment = dialog
    .getByTestId("comment")
    .filter({ hasText: "Please remove me" });
  await expect(comment).toBeVisible();

  await comment.hover();
  await comment.getByTestId("comment-delete").click();
  const confirm = page.getByRole("dialog", { name: "Delete this comment?" });
  await expect(confirm).toBeVisible();
  // Opening the confirmation must not delete anything yet. Radix hides the
  // parent dialog from the accessibility tree while the nested confirm is up,
  // so count the rows by test id instead of a role-scoped locator.
  await expect(
    page.getByTestId("comment").filter({ hasText: "Please remove me" }),
  ).toHaveCount(1);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    dialog.getByTestId("comment").filter({ hasText: "Please remove me" }),
  ).toHaveCount(0);
  await closeCardDialog(page);
  await page.reload();
  await openCard(page, "Discuss");
  await expect(
    dialog.getByTestId("comment").filter({ hasText: "Please remove me" }),
  ).toHaveCount(0);

  const remaining = await board.api.get(`/api/v1/cards/${cardId}/comments`);
  expect(remaining.ok()).toBeTruthy();
  const body = (await remaining.json()) as { items: unknown[] };
  expect(body.items).toHaveLength(0);
});
