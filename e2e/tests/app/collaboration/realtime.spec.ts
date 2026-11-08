import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/collaboration.js";
import {
  breakStream,
  expectPresence,
  installStreamBreak,
  presenceStack,
  resumeStream,
  streamAttempts,
} from "@/helpers/collaboration.js";
import {
  cardDialog,
  cardTitle,
  closeCardDialog,
  columnSection,
  openCard,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

async function acceptPartner(partner: {
  invite: (role?: "ADMIN" | "MEMBER" | "VIEWER") => Promise<void>;
  accept: () => Promise<void>;
}): Promise<void> {
  await partner.invite("MEMBER");
  await partner.accept();
}

test("a card update appears in the other Chrome context in under two seconds", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Live card");
  await acceptPartner(partner);
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await openCard(page, "Live card");
  await cardDialog(page)
    .getByRole("textbox", { name: "Title" })
    .fill("Updated live");
  const saved = page.waitForResponse(
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
      ).action?.title === "Updated live",
  );
  // One measurement only: from the user's save to the other context's
  // render. The locator timeout is a diagnostic guard, not the SLA.
  const started = Date.now();
  await closeCardDialog(page);
  await saved;

  await expect(cardTitle(partnerBrowser.page, "Updated live")).toBeVisible({
    timeout: 5000,
  });
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(cardTitle(partnerBrowser.page, "Live card")).toHaveCount(0);
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
  test.setTimeout(90_000);
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
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await acceptPartner(partner);
  await board.open(page);

  const events: string[] = [];
  const snapshots: string[] = [];
  partnerBrowser.page.on("request", (request) => {
    const url = request.url();
    if (url.includes(`/boards/${board.id}/events?`)) events.push(url);
    if (request.method() === "GET" && url.endsWith(`/boards/${board.id}`)) {
      snapshots.push(url);
    }
  });
  await installStreamBreak(partnerBrowser.page);
  const connected = partnerBrowser.page.waitForRequest((request) =>
    request.url().includes(`/boards/${board.id}/events?`),
  );
  await partner.openBoard(partnerBrowser.page);
  await connected;
  await expectPresence(partnerBrowser.page, 2);
  await expect.poll(() => events.length).toBeGreaterThan(0);

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.ok()).toBeTruthy();
  const beforeSeq = Number(snapshot.headers()["x-board-seq"]);
  const initialSince = Number(
    new URL(events[events.length - 1]).searchParams.get("since"),
  );
  expect(initialSince).toBe(beforeSeq);
  const snapshotsBefore = snapshots.length;

  // A silent drop: the stream is cut and its retries fail, with no page
  // navigation and no snapshot request in between.
  const attemptsBefore = await breakStream(partnerBrowser.page);
  await expect
    .poll(() => streamAttempts(partnerBrowser.page), { timeout: 15_000 })
    .toBeGreaterThan(attemptsBefore);

  // The command lands while the partner is disconnected.
  await board.command({
    type: "ADD_CARD",
    newCardId: randomUUID(),
    columnId: todo,
    title: "Missed card",
  });
  await expect(cardTitle(partnerBrowser.page, "Missed card")).toHaveCount(0);

  // Letting the retry through wakes the backoff at once; the server replays
  // the missed delta from the baseline before going live again.
  const resumedAt = events.length;
  await resumeStream(partnerBrowser.page);
  await expect(cardTitle(partnerBrowser.page, "Missed card")).toBeVisible({
    timeout: 15_000,
  });

  const resumed = events
    .slice(resumedAt)
    .map((url) => Number(new URL(url).searchParams.get("since")))
    .filter((since) => Number.isFinite(since) && since > 0);
  expect(resumed).toContain(beforeSeq);
  // A snapshot would also produce the card; the delta must have been
  // replayed over the stream, not re-read from the board endpoint.
  expect(snapshots.length).toBe(snapshotsBefore);
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
