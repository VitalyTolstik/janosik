import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/account.js";
import { openAccount, tokenRequest } from "@/helpers/account.js";

test("creates a board-scoped read-only key and shows its scope", async ({
  page,
  playwright,
  testIp,
  account,
}) => {
  const scopedId = await account.createBoard(`Scoped ${randomUUID()}`);
  const otherId = await account.createBoard(`Other ${randomUUID()}`);
  await account.open(page);
  await openAccount(page, "tokens");

  await page.getByTestId("token-create").click();
  await page.getByTestId("token-name").fill("Scoped reader");
  await page.getByTestId("token-board").click();
  await expect(
    page.getByTestId(`token-board-option-${scopedId}`),
  ).toBeVisible();
  await page.getByTestId(`token-board-option-${scopedId}`).click();
  await page.getByTestId("token-read-only").check();
  await page.getByTestId("token-create-submit").click();

  const reveal = page.getByTestId("token-reveal");
  await expect(reveal).toBeVisible();
  const token = (await reveal.textContent()) ?? "";
  expect(token).toMatch(/^jnk_/);
  await page.getByTestId("token-done").click();

  const row = page
    .getByTestId("token-row")
    .filter({ hasText: "Scoped reader" });
  await expect(row.getByTestId("token-scope")).toContainText("One board");
  await expect(row.getByTestId("token-scope")).toContainText("Read-only");

  const client = await tokenRequest(playwright, token, testIp);
  try {
    const boards = await client.get("/api/v1/boards");
    expect(boards.status()).toBe(200);
    const list = (await boards.json()) as { id: string }[];
    expect(list.map((board) => board.id)).toEqual([scopedId]);

    const write = await client.post(`/api/v1/boards/${scopedId}/commands`, {
      data: {
        commandId: randomUUID(),
        action: {
          boardId: scopedId,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: randomUUID(),
          title: "Refused",
        },
      },
    });
    expect(write.status()).toBe(403);

    const foreign = await client.get(`/api/v1/boards/${otherId}`);
    expect(foreign.status()).toBe(403);
  } finally {
    await client.dispose();
  }
});
