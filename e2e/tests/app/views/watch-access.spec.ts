import { expect, login } from "@/fixtures/auth.js";
import { test as boardTest } from "@/fixtures/board.js";
import { appUrl, siteUrl } from "@/helpers/urls.js";

boardTest(
  "watch feed denies an unrelated user and permits an accepted viewer",
  async ({ page, board, createUser, playwright, testIp }) => {
    await board.column("Private work");
    const viewer = await createUser();
    const loginClient = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const loginResponse = await loginClient.post("/api/v1/auth/login", {
      data: viewer,
    });
    expect(loginResponse.ok()).toBeTruthy();
    const { accessToken } = (await loginResponse.json()) as {
      accessToken: string;
    };
    await loginClient.dispose();
    const viewerApi = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    try {
      const denied = await viewerApi.get(`/api/v1/boards/${board.id}/activity`);
      expect([403, 404]).toContain(denied.status());
      const invite = await board.api.post(
        `/api/v1/boards/${board.id}/members`,
        { data: { email: viewer.email, role: "VIEWER" } },
      );
      expect(invite.ok()).toBeTruthy();
      const response = await viewerApi.get("/api/v1/invitations");
      const invitations = (await response.json()) as {
        id: string;
        boardId: string;
      }[];
      const invitation = invitations.find((item) => item.boardId === board.id);
      expect(invitation).toBeDefined();
      expect(
        (
          await viewerApi.post(`/api/v1/invitations/${invitation!.id}/accept`)
        ).ok(),
      ).toBeTruthy();
      const feed = await viewerApi.get(`/api/v1/boards/${board.id}/activity`);
      expect(feed.ok()).toBeTruthy();
      expect(JSON.stringify(await feed.json())).toContain("Private work");
      await login(page, viewer);
      await expect(page.getByTestId("account-trigger")).toBeVisible();
      await page.goto(new URL(`board/${board.id}`, appUrl).href);
      await page
        .getByRole("group", { name: "View", exact: true })
        .getByRole("button", { name: "Watch" })
        .click();
      await expect(page.getByTestId("watch-feed")).toContainText(
        "Private work",
      );
    } finally {
      await viewerApi.dispose();
    }
  },
);
