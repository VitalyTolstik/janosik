import { test, expect } from "../../../fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("edits a live link's title and privacy flags, keeping its token", async ({
  page,
  sharing,
}) => {
  const live = await sharing.createShare("live", {
    title: "Before",
    includeComments: true,
    includeAttachments: false,
  });
  await sharing.openOwner(page);

  const row = page.getByTestId("share-row").filter({ hasText: live.token });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit", exact: true }).click();

  await expect(page.getByText("Mode and token can't be changed")).toBeVisible();
  await expect(page.getByTestId("share-mode-live")).toHaveCount(0);
  await expect(page.getByTestId("share-mode-snapshot")).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Label (optional, for your list)" })
    .fill("After");
  await page.getByRole("checkbox", { name: "Show comments" }).click();
  await page.getByRole("checkbox", { name: "Show attachments" }).click();
  await page.getByTestId("share-save").click();

  const confirm = page.getByRole("dialog", {
    name: "Change what this live link shows?",
  });
  await expect(confirm).toBeVisible();
  const patched = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares/${live.id}`) &&
      response.request().method() === "PATCH",
  );
  await confirm.getByRole("button", { name: "Change visibility" }).click();
  expect((await patched).ok()).toBeTruthy();

  await expect(row).toContainText("After");
  await expect(row).toContainText("Attachments visible");
  await expect(row).toContainText(live.token);

  // The same token now serves the edited privacy flags.
  const payload = await sharing.api.get(`/api/v1/share/${live.token}`);
  expect(payload.ok()).toBeTruthy();
  const body = (await payload.json()) as {
    includeComments: boolean;
    includeAttachments: boolean;
  };
  expect(body.includeComments).toBe(false);
  expect(body.includeAttachments).toBe(true);
});
