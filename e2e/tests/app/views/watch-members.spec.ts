import { test, expect } from "@/fixtures/board.js";
import { siteUrl } from "@/helpers/urls.js";

for (const operation of [
  "invite",
  "role",
  "expiry",
  "combined",
  "remove",
] as const) {
  test(`watch shows member ${operation}`, async ({
    page,
    board,
    createUser,
    playwright,
    testIp,
  }) => {
    await board.column("Todo");
    const member = await createUser();
    let memberId = "";
    if (operation !== "invite") {
      const invited = await board.api.post(
        `/api/v1/boards/${board.id}/members`,
        {
          data: {
            email: member.email,
            role: operation === "expiry" ? "VIEWER" : "MEMBER",
          },
        },
      );
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
      const me = await memberApi.get("/api/v1/auth/me");
      ({ id: memberId } = (await me.json()) as { id: string });
      const invitations = await memberApi.get("/api/v1/invitations");
      const list = (await invitations.json()) as {
        id: string;
        boardId: string;
      }[];
      const invitation = list.find((item) => item.boardId === board.id);
      expect(invitation).toBeDefined();
      const accepted = await memberApi.post(
        `/api/v1/invitations/${invitation!.id}/accept`,
      );
      expect(accepted.ok()).toBeTruthy();
      await memberApi.dispose();
    }
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();
    let response;
    let message;
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    if (operation === "invite") {
      response = await board.api.post(`/api/v1/boards/${board.id}/members`, {
        data: { email: member.email, role: "MEMBER" },
      });
      message = "Invited a member";
    } else if (operation === "role") {
      response = await board.api.patch(
        `/api/v1/boards/${board.id}/members/${memberId}`,
        { data: { role: "VIEWER" } },
      );
      message = "Changed a member's role";
    } else if (operation === "combined") {
      response = await board.api.patch(
        `/api/v1/boards/${board.id}/members/${memberId}`,
        { data: { role: "VIEWER", expiresAt } },
      );
      message = "Changed a member's role";
    } else if (operation === "expiry") {
      response = await board.api.patch(
        `/api/v1/boards/${board.id}/members/${memberId}`,
        { data: { expiresAt } },
      );
      message = "Changed a member's access";
    } else {
      response = await board.api.delete(
        `/api/v1/boards/${board.id}/members/${memberId}`,
      );
      message = "Removed a member";
    }
    expect(response.ok(), await response.text()).toBeTruthy();
    const entry = page.getByTestId("watch-entry").filter({ hasText: message });
    await expect(entry).toContainText(member.email, { timeout: 15000 });
    if (operation === "role" || operation === "combined")
      await expect(entry).toContainText("MEMBER→VIEWER");
    if (operation === "combined") {
      const expiryEntry = page
        .getByTestId("watch-entry")
        .filter({ hasText: "Changed a member's access" });
      await expect(expiryEntry).toContainText(member.email, { timeout: 15000 });
      const feed = await board.api.get(`/api/v1/boards/${board.id}/activity`);
      const { items } = (await feed.json()) as {
        items: {
          type: string;
          changes?: { field: string; from: string | null; to: string | null }[];
        }[];
      };
      const role = items.find((item) => item.type === "member_role_changed");
      const expiry = items.find(
        (item) => item.type === "member_expiry_changed",
      );
      expect(role?.changes).toEqual([
        { field: "role", from: "MEMBER", to: "VIEWER" },
      ]);
      expect(expiry?.changes?.[0]).toMatchObject({
        field: "expiresAt",
        from: null,
        to: expiresAt,
      });
      await expect(expiryEntry).toContainText("Access until");
      const reset = await board.api.patch(
        `/api/v1/boards/${board.id}/members/${memberId}`,
        { data: { role: "MEMBER" } },
      );
      expect(reset.ok(), await reset.text()).toBeTruthy();
      await expect(
        page
          .getByTestId("watch-entry")
          .filter({ hasText: "Changed a member's role" }),
      ).toHaveCount(2, { timeout: 15000 });
      await expect(
        page
          .getByTestId("watch-entry")
          .filter({ hasText: "Changed a member's access" }),
      ).toHaveCount(2, { timeout: 15000 });
      const afterReset = await board.api.get(
        `/api/v1/boards/${board.id}/activity`,
      );
      const resetFeed = (await afterReset.json()) as { items: typeof items };
      expect(
        resetFeed.items.find((item) => item.type === "member_role_changed")
          ?.changes,
      ).toEqual([{ field: "role", from: "VIEWER", to: "MEMBER" }]);
      expect(
        resetFeed.items.find((item) => item.type === "member_expiry_changed")
          ?.changes?.[0],
      ).toMatchObject({ field: "expiresAt", from: expiresAt, to: null });
    }
  });
}
