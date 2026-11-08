import { test, expect } from "@/fixtures/account.js";
import { openAccount, PNG_1X1 } from "@/helpers/account.js";

test("saving the display name updates the header and survives a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("account-display-name").fill("Vera E2E");
  await dialog.getByTestId("account-profile-save").click();
  await expect(page.getByText("Profile updated")).toBeVisible();
  await expect(page.getByTestId("account-trigger")).toContainText("Vera E2E");

  await page.reload();
  await expect(page.getByTestId("account-trigger")).toContainText("Vera E2E");
});

test("saving an avatar color updates the header avatar", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("avatar-color-teal").click();
  await dialog.getByTestId("account-profile-save").click();
  await expect(page.getByText("Profile updated")).toBeVisible();

  const avatar = page.getByTestId("account-trigger").getByTestId("user-avatar");
  await expect(avatar).toHaveClass(/bg-teal/);

  await page.reload();
  await expect(
    page.getByTestId("account-trigger").getByTestId("user-avatar"),
  ).toHaveClass(/bg-teal/);
});

test("uploading a photo replaces the initials and survives a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("avatar-photo-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });

  await expect(page.getByText("Profile updated")).toBeVisible();
  await expect(
    dialog.getByTestId("account-profile").locator("img"),
  ).toBeVisible();
  await expect(dialog.getByTestId("user-avatar").locator("img")).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByTestId("account-trigger")
      .getByTestId("user-avatar")
      .locator("img"),
  ).toBeVisible();
});

test("uploading a non-image file is refused and keeps the initials", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("avatar-photo-input").setInputFiles({
    name: "not-an-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not an image"),
  });

  await expect(page.getByText("Could not upload the photo")).toBeVisible();
  const avatar = page.getByTestId("account-trigger").getByTestId("user-avatar");
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar).toContainText(
    account.user.email.slice(0, 1).toUpperCase(),
  );
});

test("turning off digest emails persists after a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  let dialog = await openAccount(page);
  const digest = dialog.getByTestId("account-notify-digest");
  await expect(digest).toBeChecked();

  await digest.uncheck();
  await dialog.getByTestId("account-profile-save").click();
  await expect(page.getByText("Profile updated")).toBeVisible();

  await page.reload();
  dialog = await openAccount(page);
  await expect(dialog.getByTestId("account-notify-digest")).not.toBeChecked();
});
