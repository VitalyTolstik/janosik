import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/collaboration.js";
import { addCard, memberRow, openMembers } from "@/helpers/collaboration.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 90_000 });

/**
 * TASK-177.2 (G-02): a MEMBER leaves a shared board from their own row. The
 * board disappears from the switcher, the direct URL becomes a 404 and the
 * owner keeps the card the member wrote.
 */
test("a MEMBER can leave from the switcher on a phone viewport", async ({
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();

  const page = partnerBrowser.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await partner.openBoard(page);

  await page.getByRole("button", { name: "Switch board" }).click();
  const grid = page.getByRole("grid", { name: "Switch board" });
  const row = grid.getByRole("row").filter({ hasText: board.title });
  await row
    .getByRole("button", { name: `Leave board — ${board.title}` })
    .click();
  await row.getByRole("button", { name: "Yes, leave" }).click();

  await expect(page.getByText("You left the board")).toBeVisible();
  const listed = await partner.api.get("/api/v1/boards");
  expect(listed.ok()).toBeTruthy();
  const boards = (await listed.json()) as { id: string }[];
  expect(boards.map((entry) => entry.id)).not.toContain(board.id);
});

test("a MEMBER can leave a board and loses direct access", async ({
  page: ownerPage,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await board.open(ownerPage);
  await partner.invite("MEMBER");
  await partner.accept();

  // The leaver owns a second board, so the switcher still has a live row to
  // inspect after the shared board goes away.
  const ownTitle = `Partner board ${randomUUID()}`;
  const ownBoard = await partner.api.post("/api/v1/boards", {
    data: { title: ownTitle },
  });
  expect(ownBoard.status()).toBe(201);

  const page = partnerBrowser.page;
  await partner.openBoard(page);
  await addCard(page, "Todo", "Authored by the leaver");

  const dialog = await openMembers(page);
  const own = memberRow(page, partner.user.email);
  await expect(own.getByTestId("board-member-leave")).toBeVisible();
  // The caller's own row does not offer the admin's remove-other control.
  await expect(
    own.getByRole("button", { name: `Remove — ${partner.user.email}` }),
  ).toHaveCount(0);

  await own.getByTestId("board-member-leave").click();
  await expect(own.getByTestId("member-leave-confirm")).toBeVisible();
  const left = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/members/me`) &&
      response.request().method() === "DELETE",
  );
  await own.getByRole("button", { name: "Yes, leave" }).click();
  expect((await left).status()).toBe(200);

  // The local board is dropped and the app moves to the remaining board.
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.url()).not.toContain(`/board/${board.id}`);
  await page.getByRole("button", { name: "Switch board" }).click();
  const grid = page.getByRole("grid", { name: "Switch board" });
  await expect(
    grid.getByRole("row").filter({ hasText: board.title }),
  ).toHaveCount(0);
  await expect(grid.getByRole("row").filter({ hasText: ownTitle })).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");

  // No stale access: the direct URL is denied, not rendered from a cache.
  await page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(page.getByText("Board not found")).toBeVisible();
  const listed = await partner.api.get("/api/v1/boards");
  expect(listed.ok()).toBeTruthy();
  const boards = (await listed.json()) as { id: string }[];
  expect(boards.map((row) => row.id)).not.toContain(board.id);
  const direct = await partner.api.get(`/api/v1/boards/${board.id}`);
  expect(direct.status()).toBe(403);

  // The owner still sees the leaver's card; leaving is not a content delete.
  await expect(ownerPage.getByText("Authored by the leaver")).toBeVisible();
});

for (const width of [390, 768]) {
  test(`a VIEWER can leave an archived board from the switcher at ${width}px`, async ({
    board,
    partner,
    partnerBrowser,
  }) => {
    await board.column("Todo");
    await partner.invite("VIEWER");
    await partner.accept();

    // The leaver keeps an active board to open; the shared board is archived
    // and can only be reached through the switcher row.
    const ownTitle = `Partner board ${randomUUID()}`;
    const ownBoard = await partner.api.post("/api/v1/boards", {
      data: { title: ownTitle },
    });
    expect(ownBoard.status()).toBe(201);
    const ownId = (
      (await ownBoard.json()) as {
        id: string;
      }
    ).id;
    await board.command({ type: "ARCHIVE_BOARD" });

    const page = partnerBrowser.page;
    await page.setViewportSize({ width, height: 1024 });
    await page.goto(new URL(`board/${ownId}`, appUrl).href);
    await expect(
      page.getByRole("button", { name: "Switch board" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Switch board" }).click();
    const archived = page.getByTestId("archived-section");
    const leave = archived.getByTestId("board-switcher-archived-leave");
    await expect(leave).toHaveAccessibleName(`Leave board — ${board.title}`);
    await leave.click();
    await archived.getByRole("button", { name: "Yes, leave" }).click();

    await expect(page.getByText("You left the board")).toBeVisible();
    const listed = await partner.api.get("/api/v1/boards");
    expect(listed.ok()).toBeTruthy();
    const boards = (await listed.json()) as { id: string }[];
    expect(boards.map((entry) => entry.id)).not.toContain(board.id);
  });
}
