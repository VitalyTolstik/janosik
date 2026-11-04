import { test, expect, login } from "../../../fixtures/auth.js";

test("sign in with valid credentials", async ({ page, createUser }) => {
  const user = await createUser();
  await login(page, user);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("reject a wrong password", async ({ page, createUser }) => {
  const user = await createUser();
  await login(page, { ...user, password: "incorrect-password" });
  await expect(page.getByTestId("login-error")).toHaveText(
    "Wrong email or password",
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
});

test("restore a session after reload", async ({ page, createUser }) => {
  const user = await createUser();
  await login(page, user);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("sign out and remain signed out after reload", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await login(page, user);
  await page.getByTestId("account-trigger").click();
  await page.getByTestId("account-logout").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("login-email")).toBeVisible();
});
