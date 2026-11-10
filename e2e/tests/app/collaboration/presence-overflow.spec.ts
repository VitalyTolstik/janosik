import { type BrowserContext, type Page } from "@playwright/test";

import { test, expect } from "@/fixtures/collaboration.js";
import { login, randomIp } from "@/fixtures/auth.js";
import { appUrl, siteUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 120_000 });

interface ExtraMember {
  email: string;
  context: BrowserContext;
  page: Page;
}

test("a busy board collapses its presence stack into +N with roles", async ({
  page,
  board,
  browser,
  createUser,
  playwright,
}) => {
  test.slow();
  await board.column("Todo");
  await board.open(page);

  const extras: ExtraMember[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const user = await createUser();
      const ip = randomIp();
      const client = await playwright.request.newContext({
        baseURL: siteUrl,
        extraHTTPHeaders: { "X-Forwarded-For": ip },
      });
      let token: string;
      try {
        const logged = await client.post("/api/v1/auth/login", { data: user });
        expect(logged.ok()).toBeTruthy();
        token = ((await logged.json()) as { accessToken: string }).accessToken;
      } finally {
        await client.dispose();
      }
      const api = await playwright.request.newContext({
        baseURL: siteUrl,
        extraHTTPHeaders: {
          "X-Forwarded-For": ip,
          Authorization: `Bearer ${token}`,
        },
      });
      try {
        const invited = await board.api.post(
          `/api/v1/boards/${board.id}/members`,
          { data: { email: user.email, role: "MEMBER" } },
        );
        expect(invited.status()).toBe(201);
        const invitations = await api.get("/api/v1/invitations");
        const list = (await invitations.json()) as {
          id: string;
          boardId: string;
        }[];
        const invitation = list.find((item) => item.boardId === board.id);
        expect(invitation).toBeDefined();
        const accepted = await api.post(
          `/api/v1/invitations/${invitation!.id}/accept`,
        );
        expect(accepted.ok()).toBeTruthy();
      } finally {
        await api.dispose();
      }

      const context = await browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": ip },
        locale: "en-US",
      });
      const extraPage = await context.newPage();
      await login(extraPage, user);
      await expect(extraPage.getByTestId("account-trigger")).toBeVisible();
      await extraPage.goto(new URL(`board/${board.id}`, appUrl).href);
      await expect(
        extraPage.getByRole("button", { name: "Switch board" }),
      ).toBeVisible();
      extras.push({ email: user.email, context, page: extraPage });
    }

    // Owner + five extras = six people: five avatars and a +1 overflow.
    await expect(page.getByTestId("presence-avatar")).toHaveCount(5, {
      timeout: 20_000,
    });
    await expect(page.getByTestId("presence-overflow")).toHaveText("+1");

    await page.getByTestId("presence-stack").click();
    const rows = page.getByTestId("presence-row");
    await expect(rows).toHaveCount(6);
    await expect(
      page.getByTestId("presence-row").filter({ hasText: "you" }),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("presence-row").filter({ hasText: "Member" }),
    ).toHaveCount(5);
    for (const extra of extras) {
      await expect(
        page.getByTestId("presence-row").filter({ hasText: extra.email }),
      ).toHaveCount(1);
    }
  } finally {
    await Promise.all(extras.map((extra) => extra.context.close()));
  }
});
