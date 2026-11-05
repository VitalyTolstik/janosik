import { test, expect } from "@/fixtures/board.js";
import { siteUrl } from "@/helpers/urls.js";

for (const decision of ["accept", "decline"] as const) {
  test(`watch shows an invitation ${decision}`, async ({
    page,
    board,
    createUser,
    playwright,
    testIp,
  }) => {
    await board.column("Todo");
    const member = await createUser();
    const invited = await board.api.post(`/api/v1/boards/${board.id}/members`, {
      data: { email: member.email, role: "MEMBER" },
    });
    expect(invited.status()).toBe(201);
    const client = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const login = await client.post("/api/v1/auth/login", { data: member });
    expect(login.ok()).toBeTruthy();
    const { accessToken } = (await login.json()) as { accessToken: string };
    await client.dispose();
    const memberApi = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    try {
      const response = await memberApi.get("/api/v1/invitations");
      const list = (await response.json()) as { id: string; boardId: string }[];
      const invitation = list.find((item) => item.boardId === board.id);
      expect(invitation).toBeDefined();
      await board.open(page);
      await page
        .getByRole("group", { name: "View", exact: true })
        .getByRole("button", { name: "Watch" })
        .click();
      const result = await memberApi.post(
        `/api/v1/invitations/${invitation!.id}/${decision}`,
      );
      expect(result.ok()).toBeTruthy();
      const message =
        decision === "accept"
          ? "Accepted an invitation"
          : "Declined an invitation";
      await expect(
        page.getByTestId("watch-entry").filter({ hasText: message }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await memberApi.dispose();
    }
  });
}
