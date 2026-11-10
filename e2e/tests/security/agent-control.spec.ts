import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import { createUserViaAdmin, uniqueEmail } from "@/helpers/admin.js";
import { tokenRequest } from "@/helpers/account.js";
import { appUrl, siteUrl } from "@/helpers/urls.js";
import type { BoardFixture } from "@/fixtures/board.js";

interface AgentToken {
  pat: APIRequestContext;
}

interface CreateUserTokenResponse {
  token: string;
  apiToken: { id: string };
}

/**
 * TASK-166.12 browser security lane.
 *
 * The existing `agents-permissions`, `approvals-pause` and `runs-policy`
 * suites already pin the ADMIN/MEMBER approval, pause and policy flows. This
 * small lane fills the two remaining integration gaps: a rollback committed
 * from another session must refresh the open run history via `run.reverted`,
 * and a VIEWER must not even see (or be able to call) the ADMIN-only rollback
 * control.
 */

async function createAgentToken(
  board: BoardFixture,
  playwright: Parameters<typeof tokenRequest>[0],
  testIp: string,
): Promise<AgentToken> {
  const response = await board.api.post("/api/v1/users/me/tokens", {
    data: {
      name: `Sec agent ${randomUUID().slice(0, 8)}`,
      expiresAt: null,
      scopePreset: "worker",
      boardId: null,
      trustedCi: false,
      readOnly: false,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as CreateUserTokenResponse;
  return { pat: await tokenRequest(playwright, body.token, testIp) };
}

function addCardCommand(boardId: string, columnId: string, title: string) {
  return {
    commandId: randomUUID(),
    action: {
      type: "ADD_CARD",
      boardId,
      columnId,
      newCardId: randomUUID(),
      title,
      at: Date.now(),
    },
  };
}

async function createRun(
  board: BoardFixture,
  agent: AgentToken,
  columnId: string,
  titles: string[],
): Promise<string> {
  const response = await agent.pat.post(
    `/api/v1/boards/${board.id}/commands/batch`,
    {
      data: {
        commands: titles.map((title) =>
          addCardCommand(board.id, columnId, title),
        ),
      },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { runId: string }).runId;
}

async function openRunHistory(page: Page, runId: string): Promise<void> {
  const adminTrigger = page.getByTestId("agent-control-trigger");
  if ((await adminTrigger.count()) > 0) {
    await adminTrigger.click();
    await page.getByTestId("agent-runs-tab").click();
  } else {
    await page.getByTestId("agent-runs-trigger").click();
  }
  await expect(page.getByTestId("agent-runs-tab")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId(`agent-run-row-${runId}`)).toBeVisible();
}

test.describe.configure({ timeout: 90_000 });

test("a rollback from another session refreshes the open run history via run.reverted", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const agent = await createAgentToken(board, playwright, testIp);
  try {
    const runId = await createRun(board, agent, todo, [
      "External rollback one",
      "External rollback two",
    ]);

    await board.open(page);
    await openRunHistory(page, runId);
    await expect(page.getByTestId("agent-run-status")).toHaveAttribute(
      "data-status",
      "applied",
    );
    await expect(page.getByTestId("agent-run-revert-apply")).toBeVisible();

    // The rollback is committed by the same human session through the API,
    // not by the open dialog. Only the `run.reverted` frame can update it.
    const reverted = await board.api.post(
      `/api/v1/boards/${board.id}/runs/${runId}/revert`,
      { data: { commandId: randomUUID() } },
    );
    expect(reverted.status(), await reverted.text()).toBe(200);

    await expect(page.getByTestId("agent-run-status")).toHaveAttribute(
      "data-status",
      "reverted",
    );
    await expect(page.getByTestId("agent-run-reverted-at")).toBeVisible();
    await expect(page.getByTestId("agent-run-revert-apply")).toHaveCount(0);

    const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
    expect(snapshot.status()).toBe(200);
    const aggregate = (await snapshot.json()) as {
      cards: Record<string, { title: string }>;
    };
    expect(
      Object.values(aggregate.cards).some(
        (card) => card.title === "External rollback one",
      ),
    ).toBe(false);

    const runs = await board.api.get(`/api/v1/boards/${board.id}/runs`);
    expect(runs.status()).toBe(200);
    expect(
      (await runs.json()) as Array<{ id: string; status: string }>,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: runId, status: "reverted" }),
      ]),
    );
  } finally {
    await agent.pat.dispose();
  }
});

test("a VIEWER reads run history but cannot see or call the ADMIN rollback", async ({
  board,
  browser,
  admin,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const agent = await createAgentToken(board, playwright, testIp);
  const viewerPassword = "e2e-password-123";
  let viewerApi: APIRequestContext | null = null;
  try {
    const runId = await createRun(board, agent, todo, ["Viewer sees this run"]);
    const viewer = await createUserViaAdmin(admin, {
      email: uniqueEmail("security-viewer"),
      verified: true,
      password: viewerPassword,
    });
    const added = await admin.post(`/api/v1/admin/boards/${board.id}/members`, {
      data: { email: viewer.email, role: "VIEWER" },
    });
    expect(added.ok(), await added.text()).toBe(true);

    const context = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
      locale: "en-US",
    });
    const viewerPage = await context.newPage();
    try {
      await login(viewerPage, {
        email: viewer.email,
        password: viewerPassword,
      });
      await expect(viewerPage.getByTestId("account-trigger")).toBeVisible();
      await viewerPage.goto(new URL(`board/${board.id}`, appUrl).href);
      await expect(
        viewerPage.getByRole("button", { name: "Switch board" }),
      ).toBeVisible();

      await expect(viewerPage.getByTestId("agent-control-trigger")).toHaveCount(
        0,
      );
      await expect(
        viewerPage.getByTestId("agent-control-pending-count"),
      ).toHaveCount(0);
      await expect(viewerPage.getByTestId("agent-runs-trigger")).toBeVisible();
      await openRunHistory(viewerPage, runId);
      await expect(
        viewerPage.getByTestId("agent-run-revert-apply"),
      ).toHaveCount(0);
      await expect(viewerPage.getByTestId("agent-policy-tab")).toHaveCount(0);
      // The read-only preview stays available (ADR §11.4).
      await expect(viewerPage.getByTestId("agent-run-preview")).toBeVisible();

      // Hiding the button is not the control: the API itself must refuse.
      viewerApi = await playwright.request.newContext({
        baseURL: siteUrl,
        extraHTTPHeaders: { "X-Forwarded-For": testIp },
      });
      const loggedIn = await viewerApi.post("/api/v1/auth/login", {
        data: { email: viewer.email, password: viewerPassword },
      });
      expect(loggedIn.ok(), await loggedIn.text()).toBe(true);
      const { accessToken } = (await loggedIn.json()) as {
        accessToken: string;
      };
      const denied = await viewerApi.post(
        `/api/v1/boards/${board.id}/runs/${runId}/revert`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: { commandId: randomUUID() },
        },
      );
      expect(denied.status()).toBe(403);
      expect((await denied.json()) as { code?: string }).toMatchObject({
        code: "scope_denied",
      });

      const policy = await viewerApi.get(
        `/api/v1/boards/${board.id}/agent-policy`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(policy.status()).toBe(403);
      expect((await policy.json()) as { code?: string }).toMatchObject({
        code: "scope_denied",
      });
    } finally {
      await context.close();
    }

    const run = await board.api.get(`/api/v1/boards/${board.id}/runs/${runId}`);
    expect(run.status(), await run.text()).toBe(200);
    expect((await run.json()) as { run: { status: string } }).toMatchObject({
      run: { status: "applied" },
    });
    const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
    const aggregate = (await snapshot.json()) as {
      cards: Record<string, { title: string }>;
    };
    expect(
      Object.values(aggregate.cards).some(
        (card) => card.title === "Viewer sees this run",
      ),
    ).toBe(true);
  } finally {
    await viewerApi?.dispose();
    await agent.pat.dispose();
  }
});
