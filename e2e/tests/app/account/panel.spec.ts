import { test, expect } from "@/fixtures/account.js";
import { openAccount, signOutThroughUi } from "@/helpers/account.js";

test("the account panel opens on the profile and switches between sections", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await expect(dialog).toContainText(account.user.email);
  await expect(
    page.getByText(/With Janosik since/, { exact: false }),
  ).toBeVisible();

  for (const section of ["security", "tokens", "preferences", "profile"]) {
    await dialog.getByTestId(`account-nav-${section}`).click();
    await expect(page.getByTestId(`account-${section}`)).toBeVisible();
  }
});

test("signing out asks for confirmation and returns to the login screen", async ({
  page,
  account,
}) => {
  await account.open(page);
  await signOutThroughUi(page);

  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
});
