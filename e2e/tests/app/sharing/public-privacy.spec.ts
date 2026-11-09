import { test, expect, publicUrl } from "@/fixtures/sharing.js";
import { siteUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

test("the public roster never exposes member emails", async ({
  browser,
  sharing,
}) => {
  const live = await sharing.createShare("live");
  const payload = await sharing.api.get(`/api/v1/share/${live.token}`);
  expect(payload.ok()).toBeTruthy();
  const body = (await payload.json()) as {
    members: Record<string, unknown>[];
    board: unknown;
  };
  expect(body.members.length).toBeGreaterThan(0);
  for (const member of body.members) {
    expect(member).not.toHaveProperty("email");
  }
  expect(JSON.stringify(body)).not.toContain("e2e.example");

  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(live.token));
    await expect(viewer.getByText("Live · read-only")).toBeVisible();
    await expect(viewer.getByText(/@e2e\.example/)).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
});

test("a public attachment downloads as an attachment, not inline", async ({
  browser,
  sharing,
}) => {
  const attachment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "public-file.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("public bytes"),
        },
      },
    },
  );
  expect(attachment.status()).toBe(201);
  const { id } = (await attachment.json()) as { id: string };
  const live = await sharing.createShare("live", {
    includeAttachments: true,
  });

  const anonymous = await browser.newContext();
  try {
    const response = await anonymous.request.get(
      new URL(`/api/v1/share/${live.token}/attachments/${id}/content`, siteUrl)
        .href,
      { headers: { Accept: "*/*" } },
    );
    expect(response.status()).toBe(200);
    const disposition = response.headers()["content-disposition"] ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("public-file.txt");
    expect(await response.text()).toBe("public bytes");
  } finally {
    await anonymous.close();
  }
});

test("unknown and revoked tokens answer 404 without leaking the board", async ({
  browser,
  sharing,
}) => {
  const live = await sharing.createShare("live");
  const revoked = await sharing.api.delete(
    `/api/v1/boards/${sharing.boardId}/shares/${live.id}`,
  );
  expect(revoked.ok()).toBeTruthy();

  const anonymous = await browser.newContext();
  try {
    for (const token of [live.token, "does-not-exist"]) {
      const response = await anonymous.request.get(
        new URL(`/api/v1/share/${token}`, siteUrl).href,
      );
      expect(response.status()).toBe(404);
      const text = await response.text();
      expect(text).not.toContain("Original card");

      const viewer = await anonymous.newPage();
      await viewer.goto(publicUrl(token));
      await expect(viewer.getByTestId("share-unavailable-code")).toHaveText(
        "404",
      );
      await expect(viewer.getByText(/Original card/)).toHaveCount(0);
      await viewer.close();
    }
  } finally {
    await anonymous.close();
  }
});
