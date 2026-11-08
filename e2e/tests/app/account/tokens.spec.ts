import { test, expect } from "@/fixtures/account.js";
import {
  createTokenThroughUi,
  openAccount,
  tokenRequest,
} from "@/helpers/account.js";

test("creating a key reveals it once and the list never shows it again", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "tokens");

  await page.getByTestId("token-create").click();
  await page.getByTestId("token-name").fill("CI pipeline");
  await page.getByTestId("token-create-submit").click();

  const reveal = page.getByTestId("token-reveal");
  await expect(reveal).toBeVisible();
  await expect(
    page.getByText("This is the only time the key is shown", { exact: false }),
  ).toBeVisible();
  await expect(reveal).toContainText(/^jnk_/);

  await page.getByTestId("token-done").click();
  const row = page.getByTestId("token-row").filter({ hasText: "CI pipeline" });
  await expect(row).toContainText("Active");
  await expect(row).not.toContainText("jnk_");
});

test("copying a new key puts the plaintext on the clipboard", async ({
  page,
  account,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await account.open(page);
  await openAccount(page, "tokens");

  await page.getByTestId("token-create").click();
  await page.getByTestId("token-name").fill("Clipboard key");
  await page.getByTestId("token-create-submit").click();
  const token = (await page.getByTestId("token-reveal").textContent()) ?? "";

  await page.getByTestId("token-copy").click();
  await expect(page.getByText("Key copied")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(token);
});

test("a new key authenticates a request as its owner", async ({
  page,
  account,
  playwright,
  testIp,
}) => {
  const boardId = await account.createBoard("Token board");
  await account.open(page);
  await openAccount(page, "tokens");
  const token = await createTokenThroughUi(page, "Request key");

  const client = await tokenRequest(playwright, token, testIp);
  try {
    const response = await client.get("/api/v1/boards");
    expect(response.status()).toBe(200);
    const boards = (await response.json()) as { id: string }[];
    expect(boards.some((board) => board.id === boardId)).toBe(true);

    const me = await client.get("/api/v1/auth/me");
    expect(me.status()).toBe(200);
    const profile = (await me.json()) as { email: string };
    expect(profile.email).toBe(account.user.email);
  } finally {
    await client.dispose();
  }
});

test("revoking a key asks for confirmation and marks the row revoked", async ({
  page,
  account,
}) => {
  await account.createToken("Laptop");
  await account.open(page);
  await openAccount(page, "tokens");

  const row = page.getByTestId("token-row").filter({ hasText: "Laptop" });
  await row.getByTestId("token-revoke").click();
  const confirm = page.getByRole("dialog", { name: "Revoke this key?" });
  await expect(confirm).toContainText("Requests with “Laptop” stop working");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("Active");

  await row.getByTestId("token-revoke").click();
  await page
    .getByRole("dialog", { name: "Revoke this key?" })
    .getByRole("button", { name: "Revoke" })
    .click();

  await expect(row).toContainText("Revoked");
  await expect(row.getByTestId("token-revoke")).toHaveCount(0);
});

test("a revoked key can no longer call the API", async ({
  page,
  account,
  playwright,
  testIp,
}) => {
  await account.open(page);
  await openAccount(page, "tokens");
  const token = await createTokenThroughUi(page, "Short-lived");

  const row = page.getByTestId("token-row").filter({ hasText: "Short-lived" });
  await row.getByTestId("token-revoke").click();
  await page
    .getByRole("dialog", { name: "Revoke this key?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(row).toContainText("Revoked");

  const client = await tokenRequest(playwright, token, testIp);
  try {
    const after = await client.get("/api/v1/boards");
    expect(after.status()).toBe(401);
  } finally {
    await client.dispose();
  }
});

test("an API key cannot create or list other API keys", async ({
  account,
  playwright,
  testIp,
}) => {
  const created = await account.createToken("Restricted key");
  const client = await tokenRequest(playwright, created.token, testIp);
  try {
    const list = await client.get("/api/v1/users/me/tokens");
    expect(list.status()).toBe(403);

    const create = await client.post("/api/v1/users/me/tokens", {
      data: { name: "Escalated key", expiresAt: null },
    });
    expect(create.status()).toBe(403);
  } finally {
    await client.dispose();
  }
});
