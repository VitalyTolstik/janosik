import { randomUUID } from "node:crypto";
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
  await expect(page.getByRole("option")).toHaveCount(10);

  await page.getByRole("button", { name: "New board" }).click();
  await page.getByRole("textbox", { name: "Board name" }).fill("Eleventh");
  await page.getByRole("textbox", { name: "Board name" }).press("Enter");

  // TASK-166 D19: the old ten-board cap is local/offline only. Server mode
  // accepts the eleventh board and opens it.
  await expect(page.getByRole("heading", { name: "Eleventh" })).toBeVisible();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(page.getByRole("option")).toHaveCount(11);

  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(page.getByRole("option")).toHaveCount(11);
  await expect(page.getByText("Eleventh")).toHaveCount(1);
});
