import { test, expect } from "@/fixtures/board.js";
import {
  breakStream,
  installStreamBreak,
  resumeStream,
  streamAttempts,
} from "@/helpers/collaboration.js";
import { expectToast } from "@/helpers/data.js";
import { cardTitle, columnSection } from "@/helpers/history.js";
import {
  goOffline,
  goOnline,
  pwaBuildAvailable,
  waitForServiceWorker,
} from "@/helpers/pwa.js";

/**
 * Offline behaviour of the built app (TASK-162.14). The product deliberately
 * caches only the app shell: boards, commands and the live stream require a
 * connection (see the user guide, "Offline use and installing the app").
 * These tests pin the user-visible contract around that boundary.
 */

test.skip(
  !pwaBuildAvailable,
  "PWA checks need the production self-host build under /app/ (see e2e/README.md).",
);

test("rejects an offline card creation with a clear error and no ghost card", async ({
  page,
  context,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await waitForServiceWorker(page);

  await goOffline(context, page);
  try {
    const todo = columnSection(page, "Todo");
    await todo.locator("[data-composer-trigger]").click();
    const composer = todo.locator('[name="card-composer"]');
    await composer.fill("Offline draft");
    await composer.press("Enter");

    await expectToast(page, "No network — the change was not saved");
    await expect(cardTitle(page, "Offline draft")).toHaveCount(0);
  } finally {
    await goOnline(context, page);
  }

  // The optimistic card was rolled back, not queued: the server never got it.
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.ok()).toBeTruthy();
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title: string }>;
  };
  const titles = Object.values(aggregate.cards).map((card) => card.title);
  expect(titles).not.toContain("Offline draft");
});

test("catches up on changes made while the browser was offline", async ({
  page,
  context,
  board,
}) => {
  const columnId = await board.column("Todo");
  // Chromium keeps an already-open SSE socket alive under
  // `context.setOffline`, so the outage must cut the stream explicitly.
  // The hook then holds every retry until the network is back.
  await installStreamBreak(page);
  await board.open(page);
  await waitForServiceWorker(page);
  const attemptsBefore = await breakStream(page);

  await goOffline(context, page);
  try {
    // A second writer (another tab, a teammate or an agent) keeps working
    // while this browser is cut off.
    await board.card(columnId, "Added while offline");
  } finally {
    await goOnline(context, page);
  }
  await resumeStream(page);

  // The reconnect resumes the SSE stream from its baseline seq, so the
  // missed command lands without a manual reload — and the API/stream are
  // not frozen responses from the worker cache.
  await expect(cardTitle(page, "Added while offline")).toBeVisible({
    timeout: 15_000,
  });
  expect(await streamAttempts(page)).toBeGreaterThan(attemptsBefore);
});

test("restores the session and board state after an offline reload", async ({
  page,
  context,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "Persisted card");
  await board.open(page);
  await waitForServiceWorker(page);
  await expect(cardTitle(page, "Persisted card")).toBeVisible();

  await goOffline(context, page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    // Only the shell is cached; the boot refresh needs the API, so the app
    // asks for a sign-in instead of crashing on a network error.
    await expect(page.getByTestId("login-email")).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await goOnline(context, page);
  }

  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();
  // Nothing was lost on the server by the offline reload.
  await expect(cardTitle(page, "Persisted card")).toBeVisible();
});
