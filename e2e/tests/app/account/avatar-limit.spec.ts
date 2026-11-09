import { test, expect } from "@/fixtures/account.js";
import { openAccount, PNG_1X1 } from "@/helpers/account.js";

test("rejects an avatar over 2 MB and keeps the initials", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);
  const oversized = Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)]);

  await dialog.getByTestId("avatar-photo-input").setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: oversized,
  });

  await expect(
    page.getByText("File is too large — the limit is 2 MB"),
  ).toBeVisible();
  const headerAvatar = page
    .getByTestId("account-trigger")
    .getByTestId("user-avatar");
  await expect(headerAvatar.locator("img")).toHaveCount(0);
  await expect(headerAvatar).toContainText(
    account.user.email.slice(0, 1).toUpperCase(),
  );
  await expect(dialog.locator("img")).toHaveCount(0);
});
