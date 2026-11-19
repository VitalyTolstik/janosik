import { randomUUID } from "node:crypto";
import type { Request } from "@playwright/test";
import { test, expect } from "@/fixtures/board.js";

test("does not cap the workspace at ten boards in server mode", async ({
  page,
  board,
}) => {
  for (let index = 0; index < 9; index += 1) {
    const created = await board.api.post("/api/v1/boards", {
      data: { title: `Extra ${index} ${randomUUID()}` },
    });
    expect(created.status()).toBe(201);
  }
  await board.open(page);
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(
    page.getByRole("grid", { name: "Switch board" }).getByRole("row"),
  ).toHaveCount(10);

  await page.getByRole("button", { name: "New board" }).click();
  await page.getByRole("textbox", { name: "Board name" }).fill("Eleventh");
  await page.getByRole("textbox", { name: "Board name" }).press("Enter");

  // TASK-166 D19: the old ten-board cap is local/offline only. Server mode
  // accepts the eleventh board and opens it.
  await expect(page.getByRole("heading", { name: "Eleventh" })).toBeVisible();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(
    page.getByRole("grid", { name: "Switch board" }).getByRole("row"),
  ).toHaveCount(11);

  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(
    page.getByRole("grid", { name: "Switch board" }).getByRole("row"),
  ).toHaveCount(11);
  await expect(
    page
      .getByRole("grid", { name: "Switch board" })
      .getByRole("row")
      .filter({ hasText: "Eleventh" }),
  ).toHaveCount(1);
});

test("only a valid search title sends a board creation request", async ({
  page,
  board,
}) => {
  await board.open(page);
  const requests: string[] = [];
  const isCreateBoard = (request: Request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/v1/boards";
  page.on("request", (request) => {
    if (isCreateBoard(request)) requests.push(request.postDataJSON().title);
  });

  await page.getByRole("button", { name: "Switch board" }).click();
  const dialog = page.getByRole("dialog", { name: "Switch board" });
  const search = dialog.getByRole("combobox", { name: "Search boards…" });
  const create = dialog.getByRole("button", { name: /^Create /i });
  await search.fill("x".repeat(101));
  await expect(create).toBeDisabled();
  await search.press("Enter");
  await create.press("Enter");
  expect(requests).toEqual([]);

  const validTitle = "x".repeat(100);
  await search.fill(validTitle);
  const created = page.waitForResponse((response) =>
    isCreateBoard(response.request()),
  );
  await create.click();
  expect((await created).status()).toBe(201);
  expect(requests).toEqual([validTitle]);
  await expect(page.getByRole("heading", { name: validTitle })).toBeVisible();
});
