import { test, expect } from "@/fixtures/board.js";
import { ageCommand, ageFeedEntries } from "@/helpers/disposable-database.js";

test("watch drops expired commands and activity after the retention sweep", async ({
  page,
  board,
  admin,
}) => {
  test.skip(
    !process.env.E2E_COMPOSE_PROJECT,
    "Requires the disposable Docker database",
  );
  const column = await board.column("Todo");
  const card = await board.card(column, "Before retention");
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Old change",
  });
  const comment = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: "Old comment" },
  });
  expect(comment.ok()).toBeTruthy();
  const feedResponse = await board.api.get(
    `/api/v1/boards/${board.id}/activity`,
  );
  const feed = (await feedResponse.json()) as {
    items: { id: string; type: string }[];
  };
  const oldCommand = feed.items.find((item) => item.type === "UPDATE_CARD");
  const oldActivity = feed.items.find((item) => item.type === "comment_added");
  expect(oldCommand).toBeDefined();
  expect(oldActivity).toBeDefined();
  await ageFeedEntries(board.id, oldCommand!.id, oldActivity!.id);
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Recent change",
  });
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const watch = page.getByTestId("watch-feed");
  await expect(watch).toContainText("Old comment");
  await expect(watch).toContainText("Recent change");
  for (const job of ["sweep-commands", "sweep-activity"]) {
    const response = await admin.post("/api/v1/admin/maintenance/run", {
      data: { job },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await expect
    .poll(
      async () => {
        const current = await board.api.get(
          `/api/v1/boards/${board.id}/activity`,
        );
        const { items } = (await current.json()) as { items: { id: string }[] };
        return items.some(
          (item) => item.id === oldCommand!.id || item.id === oldActivity!.id,
        );
      },
      { timeout: 20000 },
    )
    .toBe(false);
  await expect(watch).not.toContainText("Old comment", { timeout: 15000 });
  await expect(watch).toContainText("Recent change");
});

test("keeps entries just inside retention and drops only expired ones", async ({
  page,
  board,
  admin,
}) => {
  test.skip(
    !process.env.E2E_COMPOSE_PROJECT,
    "Requires the disposable Docker database",
  );
  const column = await board.column("Todo");
  const card = await board.card(column, "Retention boundary");
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Young change",
  });
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Old change",
  });
  const feedResponse = await board.api.get(
    `/api/v1/boards/${board.id}/activity`,
  );
  const feed = (await feedResponse.json()) as {
    items: { id: string; type: string }[];
  };
  const commandUpdates = feed.items.filter(
    (item) => item.type === "UPDATE_CARD",
  );
  const young = commandUpdates.find(
    (item) => item.id !== commandUpdates[0]?.id,
  );
  const old = commandUpdates[0];
  expect(young).toBeDefined();
  expect(old).toBeDefined();
  // Newest first: "Old change" is the newer command, "Young change" older.
  await ageCommand(board.id, old!.id, 35);
  await ageCommand(board.id, young!.id, 25);

  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const watch = page.getByTestId("watch-feed");
  await expect(watch).toContainText("Young change");
  await expect(watch).toContainText("Old change");

  for (const job of ["sweep-commands", "sweep-activity"]) {
    const response = await admin.post("/api/v1/admin/maintenance/run", {
      data: { job },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  await expect
    .poll(
      async () => {
        const current = await board.api.get(
          `/api/v1/boards/${board.id}/activity`,
        );
        const { items } = (await current.json()) as {
          items: { id: string }[];
        };
        return items.some((item) => item.id === old!.id);
      },
      { timeout: 20000 },
    )
    .toBe(false);
  await expect
    .poll(
      async () => {
        const current = await board.api.get(
          `/api/v1/boards/${board.id}/activity`,
        );
        const { items } = (await current.json()) as {
          items: { id: string }[];
        };
        return items.some((item) => item.id === young!.id);
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const updateRows = watch
    .getByTestId("watch-entry")
    .filter({ hasText: "Title changed" });
  await expect(updateRows).toHaveCount(1, { timeout: 15000 });
  await expect(updateRows).toContainText("Retention boundary");
  await expect(updateRows).toContainText("Young change");
});
