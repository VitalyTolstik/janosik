import type { Page } from "@playwright/test";

import { test, expect } from "@/fixtures/collaboration.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";
import { expectStillAlive, markAlive } from "@/helpers/collaboration.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

/** A comment row of the open card, located by its stable id. */
function commentRow(page: Page, commentId: string) {
  return cardDialog(page).locator(
    `[data-testid="comment"][data-comment-id="${commentId}"]`,
  );
}

test("edits an own comment in place and shows the edited marker", async ({
  page,
  board,
}) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Edit me");
  const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "First draft" },
  });
  expect(created.status()).toBe(201);
  const commentId = ((await created.json()) as { id: string }).id;

  await board.open(page);
  await openCard(page, "Edit me");
  const row = commentRow(page, commentId);
  await expect(row).toBeVisible();

  await row.hover();
  await row.getByTestId("comment-edit").click();
  const editor = row.locator('[contenteditable="true"]');
  await expect(editor).toContainText("First draft");
  await editor.fill("Edited by the author");
  await row.getByTestId("comment-edit-save").click();

  await expect(row).toContainText("Edited by the author");
  await expect(row.getByTestId("comment-edited")).toBeVisible();

  const saved = await board.api.get(`/api/v1/cards/${cardId}/comments`);
  expect(saved.ok()).toBeTruthy();
  const body = (await saved.json()) as {
    items: { id: string; text: string; editedAt?: number }[];
  };
  expect(body.items[0]).toMatchObject({
    id: commentId,
    text: "Edited by the author",
  });
  expect(body.items[0].editedAt).toEqual(expect.any(Number));
});

test("another user cannot edit someone else's comment", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Not yours");
  const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "Owner only" },
  });
  expect(created.status()).toBe(201);
  const commentId = ((await created.json()) as { id: string }).id;

  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);

  const partnerPage = partnerBrowser.page;
  await openCard(partnerPage, "Not yours");
  const row = commentRow(partnerPage, commentId);
  await expect(row).toBeVisible();
  await row.hover();
  // The foreign comment offers neither Edit nor Delete.
  await expect(row.getByTestId("comment-edit")).toHaveCount(0);
  await expect(row.getByTestId("comment-delete")).toHaveCount(0);

  // The API enforces the same rule even when the UI is bypassed.
  const forbidden = await partner.api.patch(`/api/v1/comments/${commentId}`, {
    data: { text: "Hijacked" },
  });
  expect(forbidden.status()).toBe(403);

  // …and the original stays untouched.
  const list = await board.api.get(`/api/v1/cards/${cardId}/comments`);
  const body = (await list.json()) as { items: { text: string }[] };
  expect(body.items[0].text).toBe("Owner only");
});

test("a second tab sees the edit live without a reload", async ({
  page,
  context,
  board,
}) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Live edit");
  const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "Before the edit" },
  });
  expect(created.status()).toBe(201);
  const commentId = ((await created.json()) as { id: string }).id;

  await board.open(page);
  await openCard(page, "Live edit");
  await expect(commentRow(page, commentId)).toBeVisible();
  await markAlive(page);

  const second = await context.newPage();
  try {
    await second.goto(new URL(`board/${board.id}`, appUrl).href);
    await expect(
      second.getByRole("button", { name: "Switch board" }),
    ).toBeVisible();
    await openCard(second, "Live edit");

    const secondRow = commentRow(second, commentId);
    await secondRow.hover();
    await secondRow.getByTestId("comment-edit").click();
    const editor = secondRow.locator('[contenteditable="true"]');
    await editor.fill("Edited from the second tab");
    await secondRow.getByTestId("comment-edit-save").click();
    await expect(secondRow).toContainText("Edited from the second tab");
  } finally {
    await second.close();
  }

  const firstRow = commentRow(page, commentId);
  await expect(firstRow).toContainText("Edited from the second tab", {
    timeout: 15_000,
  });
  await expect(firstRow.getByTestId("comment-edited")).toBeVisible();
  await expectStillAlive(page);
  await closeCardDialog(page);
});
