import { test, expect, publicUrl } from "@/fixtures/sharing.js";
import { delayNextRoute } from "@/helpers/network.js";

/**
 * Public-contour skeletons (SKELETON-AUDIT §4.8): an anonymous visitor gets
 * the read-only board's column geometry instead of a full-screen spinner,
 * and the public card separates loading comments/files from empty ones.
 */

test("reserves the public board layout while the payload loads", async ({
  page,
  sharing,
}) => {
  const share = await sharing.createShare("snapshot");
  await delayNextRoute(page, `**/api/v1/share/${share.token}`, 1500);

  await page.goto(publicUrl(share.token));

  const skeleton = page.getByTestId("public-board-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("public-board-skeleton-column")).toHaveCount(3);

  await expect(
    page.getByTestId("card-title").filter({ hasText: "Original card" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(skeleton).toHaveCount(0);
});

test("reserves the public card comments and attachments", async ({
  page,
  sharing,
}) => {
  const comment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "Public comment" } },
  );
  expect(comment.status()).toBe(201);
  const attachment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "public.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("public attachment"),
        },
      },
    },
  );
  expect(attachment.status()).toBe(201);
  const created = await sharing.api.post(
    `/api/v1/boards/${sharing.boardId}/shares`,
    { data: { mode: "live", includeAttachments: true } },
  );
  expect(created.status()).toBe(201);
  const share = (await created.json()) as { token: string };

  await delayNextRoute(
    page,
    `**/api/v1/share/${share.token}/cards/${sharing.cardId}/comments*`,
    1500,
  );
  await delayNextRoute(
    page,
    `**/api/v1/share/${share.token}/cards/${sharing.cardId}/attachments*`,
    1500,
  );
  await page.goto(publicUrl(share.token));
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Original card" })
    .click();

  const comments = page.getByTestId("public-comments-skeleton");
  const attachments = page.getByTestId("public-attachments-skeleton");
  await expect(comments).toBeVisible();
  await expect(comments).toHaveAttribute("aria-busy", "true");
  await expect(attachments).toBeVisible();

  await expect(page.getByTestId("public-comments")).toContainText(
    "Public comment",
    { timeout: 10_000 },
  );
  await expect(page.getByRole("link", { name: "public.txt" })).toBeVisible();
  await expect(comments).toHaveCount(0);
  await expect(attachments).toHaveCount(0);
});
