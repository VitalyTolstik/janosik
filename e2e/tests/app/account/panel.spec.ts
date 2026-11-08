import { test, expect } from "@/fixtures/account.js";
import {
  openAccount,
  showSection,
  signOutThroughUi,
  type AccountSection,
} from "@/helpers/account.js";

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
  await expect(dialog.getByTestId("account-profile")).toBeVisible();

  const sections: AccountSection[] = [
    "security",
    "tokens",
    "preferences",
    "profile",
  ];
  for (const section of sections) {
    await showSection(page, section);
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
