import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";
import { test as authTest, expect, login } from "./auth.js";
import { appUrl, siteUrl } from "../helpers/urls.js";

type Share = { id: string; token: string; mode: "live" | "snapshot" };
type Sharing = {
  boardId: string;
  cardId: string;
  api: APIRequestContext;
  openOwner: (page: Page) => Promise<void>;
  createShare: (mode: Share["mode"]) => Promise<Share>;
  addCard: (title: string) => Promise<void>;
};

export const test = authTest.extend<{ sharing: Sharing }>({
  sharing: async ({ playwright, createUser, testIp }, use) => {
    const user = await createUser();
    const client = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const loginResponse = await client.post("/api/v1/auth/login", {
      data: user,
    });
    expect(loginResponse.ok()).toBeTruthy();
    const { accessToken } = (await loginResponse.json()) as {
      accessToken: string;
    };
    const api = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    await client.dispose();
    const created = await api.post("/api/v1/boards", {
      data: { title: `Sharing ${randomUUID()}` },
    });
    expect(created.status()).toBe(201);
    const { id: boardId } = (await created.json()) as { id: string };
    const columnId = randomUUID();
    const cardId = randomUUID();
    const command = async (action: Record<string, unknown>) => {
      const response = await api.post(`/api/v1/boards/${boardId}/commands`, {
        data: {
          commandId: randomUUID(),
          action: { boardId, at: Date.now(), ...action },
        },
      });
      expect(response.status()).toBe(200);
    };
    await command({
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Shared column",
    });
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Original card",
    });
    await use({
      boardId,
      cardId,
      api,
      openOwner: async (page) => {
        await login(page, user);
        await expect(page.getByTestId("account-trigger")).toBeVisible();
        await page.goto(new URL(`board/${boardId}`, appUrl).href);
        const loaded = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/boards/${boardId}/shares`) &&
            response.request().method() === "GET",
        );
        await page.getByTestId("share-trigger").click();
        expect((await loaded).ok()).toBeTruthy();
      },
      createShare: async (mode) => {
        const response = await api.post(`/api/v1/boards/${boardId}/shares`, {
          data: { mode },
        });
        expect(response.status()).toBe(201);
        return (await response.json()) as Share;
      },
      addCard: async (title) =>
        command({ type: "ADD_CARD", newCardId: randomUUID(), columnId, title }),
    });
    await api.dispose();
  },
});

export { expect };
export function publicUrl(token: string, query = ""): string {
  return new URL(`s/${token}${query}`, appUrl).href;
}
