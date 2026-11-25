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

  await page.getByTestId("switcher-create-empty").click();
  await page.getByRole("textbox", { name: "Board name" }).fill("Eleventh");
  await page.getByTestId("switcher-create-empty-submit").click();

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
  const openEmpty = dialog.getByTestId("switcher-create-empty");
  const submit = dialog.getByTestId("switcher-create-empty-submit");
  const name = dialog.getByRole("textbox", { name: "Board name" });

  // A query over the title limit is not a valid seed: the explicit form
  // opens empty and disabled, and submitting it sends no request.
  await search.fill("x".repeat(101));
  await openEmpty.click();
  await expect(name).toHaveValue("");
  await expect(submit).toBeDisabled();
  await name.press("Enter");
  expect(requests).toEqual([]);

  // Closing just the form leaves the switcher open for the valid path.
  await name.press("Escape");
  await expect(name).toBeHidden();

  const validTitle = "x".repeat(100);
  await search.fill(validTitle);
  await openEmpty.click();
  await expect(name).toHaveValue(validTitle);
  await expect(submit).toBeEnabled();
  const created = page.waitForResponse((response) =>
    isCreateBoard(response.request()),
  );
  await submit.click();
  expect((await created).status()).toBe(201);
  expect(requests).toEqual([validTitle]);
  await expect(page.getByRole("heading", { name: validTitle })).toBeVisible();
});
