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
  // TASK-177.17: the title names the author and the body quotes the comment.
  const confirm = page.getByRole("dialog", {
    name: /^Delete .+’s comment\?$/,
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByTestId("comment-delete-author")).toContainText(
    "Author:",
  );
  await expect(confirm.getByTestId("comment-delete-excerpt")).toHaveText(
    "Please remove me",
  );
  await expect(confirm).toContainText("This cannot be undone.");
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

test.describe("mobile touch targets", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("delete and confirmation controls are at least 44 px", async ({
    page,
    board,
  }) => {
    const column = await board.column("Touch");
    const cardId = await board.card(column, "Touch targets");
    const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: "Touch me" },
    });
    expect(created.status()).toBe(201);
    await board.open(page);
    await openCard(page, "Touch targets");
    const dialog = cardDialog(page);
    const comment = dialog
      .getByTestId("comment")
      .filter({ hasText: "Touch me" });
    await expect(comment).toBeVisible();

    // 177.8 still owns making the hover-revealed action visible on touch; this
    // check covers only the enlarged target size.
    const trigger = comment.getByTestId("comment-delete");
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await trigger.click({ force: true });
    const confirm = page.getByRole("dialog", {
      name: /^Delete .+’s comment\?$/,
    });
    await expect(confirm).toBeVisible();
    for (const name of ["Delete", "Cancel"]) {
      const box = await confirm
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
