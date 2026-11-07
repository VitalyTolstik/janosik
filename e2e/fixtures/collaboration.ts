import {
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { test as boardTest, expect } from "./board.js";
import { login } from "./auth.js";
import { appUrl, siteUrl } from "../helpers/urls.js";

export type CollaborationRole = "ADMIN" | "MEMBER" | "VIEWER";

interface Invitation {
  id: string;
  boardId: string;
  role: CollaborationRole;
}

interface Partner {
  user: { email: string; password: string };
  userId: string;
  api: APIRequestContext;
  /** The owner invites this account and the row stays pending. */
  invite: (role?: CollaborationRole, expiresAt?: string) => Promise<void>;
  invitations: () => Promise<Invitation[]>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  /** `undefined` while the invitation is pending or after a removal. */
  role: () => Promise<CollaborationRole | undefined>;
  /** Sign the partner in; the page stays where it is (the app shell). */
  open: (page: Page) => Promise<void>;
  /** Open the owner's board (only meaningful after accepting). */
  openBoard: (page: Page) => Promise<void>;
}

interface PartnerBrowser {
  context: BrowserContext;
  page: Page;
}

/**
 * A second account on the owner's board. It starts without access: the test
 * decides whether to leave the invitation pending, accept it through the
 * bell, decline it, or answer it through the API for setup. The browser
 * fixture is a genuinely independent Chrome context, so realtime, presence
 * and two-writer conflicts exercise the production transport, not a mock.
 */
export const test = boardTest.extend<{
  partner: Partner;
  partnerBrowser: PartnerBrowser;
}>({
  partner: async ({ board, createUser, playwright, testIp }, use) => {
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
      const meResponse = await api.get("/api/v1/auth/me");
      expect(meResponse.ok()).toBeTruthy();
      const { id: userId } = (await meResponse.json()) as { id: string };

      const invitations = async (): Promise<Invitation[]> => {
        const response = await api.get("/api/v1/invitations");
        expect(response.ok()).toBeTruthy();
        return (await response.json()) as Invitation[];
      };
      const pendingInvitation = async (): Promise<Invitation> => {
        const invitation = (await invitations()).find(
          (item) => item.boardId === board.id,
        );
        expect(invitation, "pending invitation").toBeDefined();
        return invitation!;
      };

      await use({
        user,
        userId,
        api,
        invite: async (role = "MEMBER", expiresAt) => {
          const response = await board.api.post(
            `/api/v1/boards/${board.id}/members`,
            { data: { email: user.email, role, expiresAt } },
          );
          expect(response.status()).toBe(201);
        },
        invitations,
        accept: async () => {
          const invitation = await pendingInvitation();
          const response = await api.post(
            `/api/v1/invitations/${invitation.id}/accept`,
          );
          expect(response.ok()).toBeTruthy();
        },
        decline: async () => {
          const invitation = await pendingInvitation();
          const response = await api.post(
            `/api/v1/invitations/${invitation.id}/decline`,
          );
          expect(response.ok()).toBeTruthy();
        },
        role: async () => {
          const response = await api.get("/api/v1/boards");
          expect(response.ok()).toBeTruthy();
          const boards = (await response.json()) as {
            id: string;
            role: CollaborationRole;
          }[];
          return boards.find((item) => item.id === board.id)?.role;
        },
        open: async (page) => {
          await login(page, user);
          await expect(page.getByTestId("account-trigger")).toBeVisible();
        },
        openBoard: async (page) => {
          await page.goto(new URL(`board/${board.id}`, appUrl).href);
          await expect(
            page.getByRole("button", { name: "Switch board" }),
          ).toBeVisible();
          await expect(page.locator("header h2")).toHaveText(board.title);
        },
      });
    } finally {
      await api.dispose();
    }
  },
  partnerBrowser: async ({ browser, partner, testIp }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
      locale: "en-US",
    });
    const page = await context.newPage();
    await partner.open(page);
    try {
      await use({ context, page });
    } finally {
      await context.close().catch(() => undefined);
    }
  },
});

export { expect };
