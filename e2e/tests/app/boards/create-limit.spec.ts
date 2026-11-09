import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";

test("shows the board limit at ten boards", async ({ page, board }) => {
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

  await expect(
    page.getByRole("status").filter({
      hasText: "You can have at most 10 boards",
    }),
  ).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(10);

  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(page.getByRole("option")).toHaveCount(10);
  await expect(page.getByText("Eleventh")).toHaveCount(0);
});
