import { test, expect } from "@/fixtures/board.js";

test("deletes a saved copy and shows the empty state", async ({
  page,
  board,
}) => {
  await board.open(page);
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: "Data & backups" }).click();
    await page.getByRole("menuitem", { name: "Save a copy now" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Backup saved" }).first(),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-backups").click();
  await expect(page.getByTestId("backup-row")).toHaveCount(2);
  await page
    .getByTestId("backup-row")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByTestId("backup-row")).toHaveCount(1);
  await page
    .getByTestId("backup-row")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByTestId("backup-row")).toHaveCount(0);
  await expect(page.getByTestId("backup-list")).toContainText("No backups yet");

  await page.reload();
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-backups").click();
  await expect(page.getByTestId("backup-row")).toHaveCount(0);
  await expect(page.getByTestId("backup-list")).toContainText("No backups yet");
});
