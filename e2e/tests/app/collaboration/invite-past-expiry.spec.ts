import { test, expect } from "@/fixtures/collaboration.js";
import { openMembers } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 60_000 });

test("the invite calendar refuses an access deadline in the past", async ({
  page,
  board,
  partner,
}) => {
  await board.open(page);
  const dialog = await openMembers(page);
  await dialog.getByRole("textbox", { name: "Email" }).fill(partner.user.email);
  await dialog.getByRole("button", { name: "Role", exact: true }).click();
  await page.getByRole("radio", { name: "Viewer", exact: true }).click();
  await dialog.getByTestId("expiry-trigger").click();
  await expect(page.getByTestId("expiry-calendar")).toBeVisible();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.getMonth() !== new Date().getMonth()) {
    await page
      .getByTestId("expiry-calendar")
      .getByRole("button", { name: /previous month/i })
      .click();
  }
  const day = page.locator(
    `[data-slot="calendar"] button[data-day="${yesterday.toLocaleDateString(
      "en-US",
    )}"]`,
  );
  await expect(day).toBeVisible();
  await expect(day).toBeDisabled();

  // Nothing was written while only a past deadline was on the table.
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/members")) {
      posted.push(request.url());
    }
  });
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(posted).toEqual([]);
});
