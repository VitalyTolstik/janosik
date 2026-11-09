import { test, expect } from "../../../fixtures/board.js";
import { appUrl } from "../../../helpers/urls.js";

test("keeps both tabs signed in across simultaneous reloads", async ({
  page,
  context,
  board,
}) => {
  await board.open(page);
  await expect(page.getByTestId("account-trigger")).toBeVisible();

  const second = await context.newPage();
  await second.goto(appUrl);
  await expect(second.getByTestId("account-trigger")).toBeVisible();
  await second.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    second.getByRole("heading", { name: board.title }),
  ).toBeVisible();

  // Two tabs share one refresh cookie. Reloading both at the same instant
  // presents the same token twice; the client must serialize the rotation so
  // the server does not revoke the pair as a reuse attack.
  for (let round = 0; round < 2; round += 1) {
    await Promise.all([
      page.reload({ waitUntil: "domcontentloaded" }),
      second.reload({ waitUntil: "domcontentloaded" }),
    ]);
    for (const tab of [page, second]) {
      await expect(tab.getByTestId("account-trigger")).toBeVisible();
      await expect(tab.getByTestId("login-email")).toHaveCount(0);
      await expect(
        tab.getByRole("heading", { name: board.title }),
      ).toBeVisible();
    }
  }
});
