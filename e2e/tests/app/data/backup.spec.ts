import { test, expect } from "@/fixtures/data.js";
import { expectToast, openDataMenu } from "@/helpers/data.js";

test("disables restoring a local backup in server mode", async ({
  page,
  board,
}) => {
  await board.open(page);

  const menu = await openDataMenu(page);
  await menu.getByRole("menuitem", { name: "Save a copy now" }).click();
  await expectToast(page, "Backup saved");

  await openDataMenu(page);
  await page.getByTestId("data-backups").click();
  const dialog = page.getByRole("dialog", { name: "Automatic backups" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("backup-row").first()).toBeVisible();

  const restore = dialog.getByRole("button", { name: "Restore" }).first();
  await expect(restore).toBeDisabled();
  await expect(restore).toHaveAttribute("title", /server mode/);
});
