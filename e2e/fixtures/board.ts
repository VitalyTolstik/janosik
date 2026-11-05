import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";
import { test as authTest, expect, login } from "./auth.js";
import { appUrl, siteUrl } from "../helpers/urls.js";

type BoardFixture = {
  id: string;
  api: APIRequestContext;
  open: (page: Page) => Promise<void>;
  command: (action: Record<string, unknown>) => Promise<void>;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
};

export const test = authTest.extend<{ board: BoardFixture }>({
  board: async ({ playwright, createUser, testIp }, use) => {
    const user = await createUser();
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
      const created = await api.post("/api/v1/boards", {
        data: { title: `Board ${randomUUID()}` },
      });
      expect(created.status()).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const command = async (action: Record<string, unknown>) => {
        const response = await api.post(`/api/v1/boards/${id}/commands`, {
          data: {
            commandId: randomUUID(),
            action: { boardId: id, at: Date.now(), ...action },
          },
        });
        expect(response.status(), await response.text()).toBe(200);
      };
      await use({
        id,
        api,
        command,
        open: async (page) => {
          await login(page, user);
          await expect(page.getByTestId("account-trigger")).toBeVisible();
          await page.goto(new URL(`board/${id}`, appUrl).href);
          await expect(
            page.getByRole("button", { name: "Switch board" }),
          ).toBeVisible();
        },
        column: async (title) => {
          const newColumnId = randomUUID();
          await command({ type: "ADD_COLUMN", newColumnId, title });
          return newColumnId;
        },
        card: async (columnId, title) => {
          const newCardId = randomUUID();
          await command({ type: "ADD_CARD", newCardId, columnId, title });
          return newCardId;
        },
      });
    } finally {
      await api.dispose();
    }
  },
});
export { expect };
