import { test, expect } from "@/fixtures/board.js";
import { expectToast } from "@/helpers/data.js";
import { cardDialog, cardTitle, openCard } from "@/helpers/history.js";
import {
  goOffline,
  goOnline,
  pwaBuildAvailable,
  waitForServiceWorker,
} from "@/helpers/pwa.js";

test.skip(
  !pwaBuildAvailable,
  "PWA checks need the production self-host build under /app/ (see e2e/README.md).",
);

test("rolls back an offline card edit and keeps the server title", async ({
  page,
  context,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Original title");
  await board.open(page);
  await waitForServiceWorker(page);
  await expect(cardTitle(page, "Original title")).toBeVisible();
  await openCard(page, "Original title");
  const dialog = cardDialog(page);

  await goOffline(context, page);
  try {
    await dialog.getByRole("textbox", { name: "Title" }).fill("Offline title");
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
    await expectToast(page, "No network — the change was not saved");
    await expect(cardTitle(page, "Original title")).toBeVisible();
    await expect(cardTitle(page, "Offline title")).toHaveCount(0);
  } finally {
    await goOnline(context, page);
  }

  await page.reload();
  await expect(cardTitle(page, "Original title")).toBeVisible();
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.ok()).toBeTruthy();
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title: string }>;
  };
  expect(
    Object.values(aggregate.cards).map((card) => card.title),
  ).not.toContain("Offline title");
});
