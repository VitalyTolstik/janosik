import { test, expect } from "@/fixtures/sharing.js";

test("public link lifecycle and secret stay out of Watch", async ({
  page,
  sharing,
}) => {
  const share = await sharing.createShare("live");
  const path = `/api/v1/boards/${sharing.boardId}/shares/${share.id}`;
  expect((await sharing.api.delete(path)).ok()).toBeTruthy();
  expect((await sharing.api.delete(`${path}/permanent`)).ok()).toBeTruthy();
  const response = await sharing.api.get(
    `/api/v1/boards/${sharing.boardId}/activity`,
  );
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).not.toContain(share.token);
  expect(body).not.toContain(share.id);
  await sharing.openOwner(page);
  await page.keyboard.press("Escape");
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const feed = page.getByTestId("watch-feed");
  await expect(feed).toContainText("Shared column");
  await expect(feed).not.toContainText(share.token);
});
