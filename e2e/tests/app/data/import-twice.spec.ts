import { test, expect } from "@/fixtures/data.js";
import { chooseImportFile } from "@/helpers/data.js";

test("importing the same file twice creates two independent boards", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard({
    columns: ["Todo"],
    cards: [{ column: "Todo", title: "Twice card" }],
  });
  await board.open(page);

  const firstImport = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v1/boards/import"),
  );
  await chooseImportFile(page, importable.file);
  expect((await firstImport).status()).toBe(201);
  const secondImport = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v1/boards/import"),
  );
  await chooseImportFile(page, importable.file);
  expect((await secondImport).status()).toBe(201);
  // Both imports finish back-to-back and each leaves a success toast for
  // 4.5 s, so two "Board imported" statuses can be on screen at once. Assert
  // the newest one instead of letting strict mode resolve a duplicate.
  await expect(
    page.getByRole("status").filter({ hasText: "Board imported" }).last(),
  ).toBeVisible();

  await expect
    .poll(
      async () =>
        (await data.listBoards()).filter(
          (entry) => entry.title === importable.title,
        ).length,
    )
    .toBe(2);
  const copies = (await data.listBoards()).filter(
    (entry) => entry.title === importable.title,
  );
  const [first, second] = copies;
  expect(first.id).not.toBe(second.id);
  for (const copy of copies) {
    const exported = await data.exportBoard(copy.id);
    expect(exported.boards[0].title).toBe(importable.title);
    expect(
      Object.values(exported.boards[0].cards).map((card) => card.title),
    ).toContain("Twice card");
  }

  const removed = await board.api.delete(`/api/v1/boards/${first.id}`);
  expect(removed.ok()).toBeTruthy();
  const remaining = await data.listBoards();
  const left = remaining.filter((entry) => entry.title === importable.title);
  expect(left).toHaveLength(1);
  expect(left[0].id).toBe(second.id);
});
