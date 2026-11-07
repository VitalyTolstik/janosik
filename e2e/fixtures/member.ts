import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";
import { appUrl, siteUrl } from "../helpers/urls.js";
import { test as boardTest, expect } from "./board.js";
import { login } from "./auth.js";

interface Member {
  user: { email: string; password: string };
  userId: string;
  api: APIRequestContext;
  command: (action: Record<string, unknown>) => Promise<void>;
  open: (page: Page) => Promise<void>;
}

/**
 * A second account invited to the board as MEMBER and already accepted the
 * invitation. Its `api` context can make foreign commands; `open` signs the
 * same user into a browser page.
 */
export const test = boardTest.extend<{ member: Member }>({
  member: async ({ playwright, createUser, testIp, board }, use) => {
    const user = await createUser();
    const invited = await board.api.post(`/api/v1/boards/${board.id}/members`, {
      data: { email: user.email, role: "MEMBER" },
    });
    expect(invited.status()).toBe(201);

    const client = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const logged = await client.post("/api/v1/auth/login", { data: user });
    expect(logged.ok()).toBeTruthy();
    const { accessToken } = (await logged.json()) as { accessToken: string };
    await client.dispose();

    const api = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    try {
      const invitations = await api.get("/api/v1/invitations");
      expect(invitations.ok()).toBeTruthy();
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
      const me = await api.get("/api/v1/auth/me");
      expect(me.ok()).toBeTruthy();
      const { id: userId } = (await me.json()) as { id: string };

      const command = async (action: Record<string, unknown>) => {
        const response = await api.post(`/api/v1/boards/${board.id}/commands`, {
          data: {
            commandId: randomUUID(),
            action: { boardId: board.id, at: Date.now(), ...action },
          },
        });
        expect(response.status(), await response.text()).toBe(200);
      };

      await use({
        user,
        userId,
        api,
        command,
        open: async (page) => {
          await login(page, user);
          await expect(page.getByTestId("account-trigger")).toBeVisible();
          await page.goto(new URL(`board/${board.id}`, appUrl).href);
          await expect(
            page.getByRole("button", { name: "Switch board" }),
          ).toBeVisible();
        },
      });
    } finally {
      await api.dispose();
    }
  },
});

export { expect };
