import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence, presenceStack } from "@/helpers/collaboration.js";
import { createExtraBoard } from "@/helpers/boards.js";
import { cardTitle, columnSection } from "@/helpers/history.js";

async function acceptPartner(partner: {
  invite: (role?: "ADMIN" | "MEMBER" | "VIEWER") => Promise<void>;
  accept: () => Promise<void>;
}): Promise<void> {
  await partner.invite("MEMBER");
  await partner.accept();
}

test("a card appears in the other Chrome context in under two seconds", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await acceptPartner(partner);
  await board.open(page);
  const connected = partnerBrowser.page.waitForRequest((request) =>
    request.url().includes("/events?"),
  );
  await partner.openBoard(partnerBrowser.page);
  await connected;
  await expectPresence(partnerBrowser.page, 2);

  const todo = columnSection(page, "Todo");
  await todo.locator("[data-composer-trigger]").click();
  const composer = todo.locator('[name="card-composer"]');
  await composer.fill("Live card");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "ADD_CARD",
  );
  const started = Date.now();
  await composer.press("Enter");
  await saved;

  await expect(cardTitle(partnerBrowser.page, "Live card")).toBeVisible({
    timeout: 2000,
  });
  expect(Date.now() - started).toBeLessThan(2000);
  await page.keyboard.press("Escape");
});

test("both collaborators appear in the presence stack", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await acceptPartner(partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);

  await expectPresence(page, 2);
  await expectPresence(partnerBrowser.page, 2);
});

test("presence disappears within a minute after the other tab closes", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  test.setTimeout(75_000);
  await board.column("Todo");
  await acceptPartner(partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(page, 2);

  const closedAt = Date.now();
  await partnerBrowser.context.close();

  await expect(presenceStack(page)).toBeHidden({ timeout: 60_000 });
  expect(Date.now() - closedAt).toBeLessThanOrEqual(60_000);
});

test("a missed update is caught up when the stream resumes with since", async ({
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await acceptPartner(partner);
  const extra = await createExtraBoard(
    partner.api,
    `Partner board ${randomUUID()}`,
  );

  // Reload after accepting so the partner's store knows both boards.
  await partnerBrowser.page.reload();
  await expect(
    partnerBrowser.page.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  await partnerBrowser.page
    .getByRole("button", { name: "Switch board" })
    .click();
  await expect(
    partnerBrowser.page.getByRole("option").filter({ hasText: extra.title }),
  ).toBeVisible({ timeout: 15_000 });
  await partnerBrowser.page.keyboard.press("Escape");

  const events: string[] = [];
  partnerBrowser.page.on("request", (request) => {
    if (request.url().includes(`/boards/${board.id}/events?`)) {
      events.push(request.url());
    }
  });
  await partner.openBoard(partnerBrowser.page);
  await expect.poll(() => events.length).toBeGreaterThan(0);

  // Leaving the board closes the stream; the command lands while it is down.
  await partnerBrowser.page
    .getByRole("button", { name: "Switch board" })
    .click();
  await partnerBrowser.page
    .getByRole("option")
    .filter({ hasText: extra.title })
    .click();
  await expect(partnerBrowser.page.locator("header h2")).toHaveText(
    extra.title,
  );

  const newCardId = randomUUID();
  await board.command({
    type: "ADD_CARD",
    newCardId,
    columnId: todo,
    title: "Missed card",
  });
  await expect(cardTitle(partnerBrowser.page, "Missed card")).toHaveCount(0);

  // Back on the board the stream resumes from its last applied seq and the
  // server replays the missed delta before going live again.
  const before = events.length;
  await partnerBrowser.page
    .getByRole("button", { name: "Switch board" })
    .click();
  await partnerBrowser.page
    .getByRole("option")
    .filter({ hasText: board.title })
    .click();
  await expect(partnerBrowser.page.locator("header h2")).toHaveText(
    board.title,
  );

  await expect(cardTitle(partnerBrowser.page, "Missed card")).toBeVisible({
    timeout: 15_000,
  });
  const resumed = events
    .slice(before)
    .map((url) => Number(new URL(url).searchParams.get("since")))
    .filter((since) => Number.isFinite(since) && since > 0);
  expect(resumed.length).toBeGreaterThan(0);
});

test("a repeated commandId applies the command once", async ({ board }) => {
  const todo = await board.column("Todo");
  const cardId = randomUUID();
  const commandId = randomUUID();
  const action = {
    boardId: board.id,
    at: Date.now(),
    type: "ADD_CARD",
    newCardId: cardId,
    columnId: todo,
    title: "Only once",
  };
  const post = () =>
    board.api.post(`/api/v1/boards/${board.id}/commands`, {
      data: { commandId, action },
    });
  const snapshot = async () => {
    const response = await board.api.get(`/api/v1/boards/${board.id}`);
    expect(response.ok()).toBeTruthy();
    return {
      seq: Number(response.headers()["x-board-seq"]),
      board: (await response.json()) as {
        columns: { id: string; cardIds: string[] }[];
        cards: Record<string, { title: string }>;
      },
    };
  };

  const firstResponse = await post();
  const firstText = await firstResponse.text();
  expect(firstResponse.status(), firstText).toBe(200);
  const first = JSON.parse(firstText) as unknown;
  const before = await snapshot();
  const secondResponse = await post();
  const secondText = await secondResponse.text();
  expect(secondResponse.status(), secondText).toBe(200);
  expect(JSON.parse(secondText)).toEqual(first);
  const after = await snapshot();

  expect(after.seq).toBe(before.seq);
  expect(
    Object.values(after.board.cards).filter(
      (card) => card.title === "Only once",
    ),
  ).toHaveLength(1);
  expect(
    after.board.columns
      .find((column) => column.id === todo)!
      .cardIds.filter((id) => id === cardId),
  ).toHaveLength(1);
});
