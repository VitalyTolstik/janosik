import { test, expect } from "@/fixtures/account.js";
import { newEmail, openAccount } from "@/helpers/account.js";

async function openChange(page: import("@playwright/test").Page) {
  const dialog = await openAccount(page);
  await dialog.getByTestId("account-email-change").click();
  const change = page.getByTestId("email-change-dialog");
  await expect(change).toBeVisible();
  return { dialog, change };
}

test("reports a wrong current password", async ({ page, account }) => {
  await account.open(page);
  const { change } = await openChange(page);

  await change.getByTestId("email-change-new").fill(newEmail("wrong-pass"));
  await change.getByTestId("email-change-password").fill("definitely-wrong");
  await change.getByTestId("email-change-send").click();

  await expect(change.getByTestId("email-change-error")).toHaveText(
    "Current password is incorrect",
  );
  await expect(change).toBeVisible();
  await expect(change.getByTestId("email-change-new")).not.toHaveValue("");

  const me = await account.api.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  expect(((await me.json()) as { email: string }).email).toBe(
    account.user.email,
  );
});

test("reports an address already in use", async ({
  page,
  account,
  createUser,
}) => {
  const other = await createUser();
  await account.open(page);
  const { change } = await openChange(page);

  await change.getByTestId("email-change-new").fill(other.email);
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByTestId("email-change-send").click();

  await expect(change.getByTestId("email-change-error")).toHaveText(
    "This email is already registered",
  );
  await expect(change).toBeVisible();

  const me = await account.api.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  expect(((await me.json()) as { email: string }).email).toBe(
    account.user.email,
  );
});
