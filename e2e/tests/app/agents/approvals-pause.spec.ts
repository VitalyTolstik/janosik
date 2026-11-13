import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import { createUserViaAdmin, uniqueEmail } from "@/helpers/admin.js";
import { openAccount, tokenRequest } from "@/helpers/account.js";
import { expireApproval } from "@/helpers/disposable-database.js";
import { appUrl } from "@/helpers/urls.js";
import type { BoardFixture } from "@/fixtures/board.js";

/**
 * TASK-166.14 browser flow: a human board ADMIN approves or rejects the exact
 * plan hash an agent requested, then pauses/resumes agents at board, session
 * and token scope. The agent side is a real PAT request context, so the tests
 * prove the `403 agent_paused` and one-time apply rules, not only the pixels.
 */

async function createAgentToken(
  board: BoardFixture,
  playwright: Parameters<typeof tokenRequest>[0],
  testIp: string,
): Promise<APIRequestContext> {
  const created = await board.api.post("/api/v1/users/me/tokens", {
    data: {
      name: `E2E agent ${randomUUID()}`,
      expiresAt: null,
      scopePreset: "worker",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { token: string };
  return tokenRequest(playwright, body.token, testIp);
}

interface ApprovalRef {
  approvalId: string;
  planHash: string;
  commandId: string;
}

function deleteAction(boardId: string, cardId: string) {
  return { type: "DELETE_CARD", boardId, cardId, at: Date.now() };
}

/** A destructive PAT command creates the approval and applies nothing. */
async function requestCardDelete(
  pat: APIRequestContext,
  boardId: string,
  cardId: string,
): Promise<ApprovalRef> {
  const commandId = randomUUID();
  const refused = await pat.post(`/api/v1/boards/${boardId}/commands`, {
    data: {
      commandId,
      action: deleteAction(boardId, cardId),
    },
  });
  expect(refused.status()).toBe(409);
  const body = (await refused.json()) as Record<string, unknown>;
  expect(body.code).toBe("approval_required");
  expect(body.approvalId).toEqual(expect.any(String));
  expect(body.planHash).toMatch(/^[0-9a-f]{64}$/);
  return {
    approvalId: body.approvalId as string,
    planHash: body.planHash as string,
    commandId,
  };
}

async function applyCardDelete(
  pat: APIRequestContext,
  boardId: string,
  cardId: string,
  ref: ApprovalRef,
) {
  return pat.post(`/api/v1/boards/${boardId}/commands`, {
    headers: { "X-Approval-Id": ref.approvalId },
    data: {
      commandId: ref.commandId,
      action: deleteAction(boardId, cardId),
    },
  });
}

async function openAgentControl(page: Page) {
  await page.getByTestId("agent-control-trigger").click();
  await expect(page.getByTestId("agent-control-dialog")).toBeVisible();
}

test.describe.configure({ timeout: 90_000 });

test("an agent request appears live, is approved with a reason and consumed after apply", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Delete me with approval");
  const pat = await createAgentToken(board, playwright, testIp);

  // Wait for the header store and the board SSE stream before creating the
  // approval: a frame sent while `/events` is still connecting is lost and
  // the 30 s poll would hide the live update this test proves.
  const overviewLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/agents/overview") &&
      response.status() === 200,
  );
  const liveConnected = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/boards/${board.id}/events`) &&
      response.status() === 200,
  );
  await board.open(page);
  await Promise.all([overviewLoaded, liveConnected]);

  // The page is already open and its SSE stream is connected; the badge is
  // fed by the approval SSE frame.
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/agents/overview") &&
      response.status() === 200,
  );
  const ref = await requestCardDelete(pat, board.id, cardId);
  await refreshed;
  await expect(page.getByTestId("agent-control-pending-count")).toHaveText("1");

  await openAgentControl(page);
  await expect(page.getByTestId("agent-control-dialog")).toContainText(
    "Delete me with approval",
  );
  await page.getByTestId(`approval-row-${ref.approvalId}`).click();
  await expect(page.getByTestId("approval-plan-hash")).toHaveText(ref.planHash);
  await expect(page.getByTestId("approval-plan-command")).toContainText(
    "DELETE_CARD",
  );
  await expect(page.getByTestId("approval-risk")).toContainText("Medium risk");

  await page.getByTestId("approval-approve").click();
  await expect(page.getByTestId("approval-approve-dialog")).toBeVisible();
  await page.getByTestId("approval-confirm").click();
  await expect(page.getByTestId("approval-status")).toHaveAttribute(
    "data-status",
    "approved",
  );

  // The agent applies the same plan with the approval id; the open dialog
  // follows the `approval` SSE frame to consumed without a reload.
  const applied = await applyCardDelete(pat, board.id, cardId, ref);
  expect(applied.status(), await applied.text()).toBe(200);
  await expect(page.getByTestId("approval-status")).toHaveAttribute(
    "data-status",
    "consumed",
  );

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.status()).toBe(200);
  const body = (await snapshot.json()) as { cards: Record<string, unknown> };
  expect(body.cards[cardId]).toBeUndefined();
});

test("the global agents inbox lists and approves a board request", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Approve from the global inbox");
  const pat = await createAgentToken(board, playwright, testIp);
  const ref = await requestCardDelete(pat, board.id, cardId);

  await board.open(page);
  await page.goto(new URL("agents", appUrl).href);
  await expect(page.getByTestId("agents-page")).toBeVisible();
  const row = page.getByTestId(`agents-approval-${ref.approvalId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(page.getByTestId("agents-approval-detail")).toBeVisible();
  await expect(page.getByTestId("approval-plan-hash")).toContainText(
    ref.planHash.slice(0, 44),
  );
  await page
    .getByTestId("agents-approval-technical")
    .locator("summary")
    .click();
  await expect(
    page.getByTestId("agents-approval-technical").locator("pre"),
  ).toContainText("DELETE_CARD");
  await page.getByTestId("approval-approve").click();
  await expect(page.getByTestId("approval-approve-dialog")).toBeVisible();
  await page.getByTestId("approval-confirm").click();
  await expect(page.getByTestId("approval-status")).toHaveAttribute(
    "data-status",
    "approved",
  );
});

test("rejecting a request keeps the card and records the reason", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Keep me after rejection");
  const pat = await createAgentToken(board, playwright, testIp);
  const ref = await requestCardDelete(pat, board.id, cardId);
  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId(`approval-row-${ref.approvalId}`).click();

  await page.getByTestId("approval-reject").click();
  await page.getByTestId("approval-comment").fill("Not this card");
  await page.getByTestId("approval-confirm").click();
  await expect(page.getByTestId("approval-status")).toHaveAttribute(
    "data-status",
    "rejected",
  );
  await expect(page.getByTestId("approval-comment-view")).toContainText(
    "Not this card",
  );

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const body = (await snapshot.json()) as {
    cards: Record<string, unknown>;
  };
  expect(body.cards[cardId]).toBeDefined();
});

test("an overdue request is shown as expired with no decision controls", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Expire this request");
  const pat = await createAgentToken(board, playwright, testIp);
  const ref = await requestCardDelete(pat, board.id, cardId);
  await expireApproval(ref.approvalId);

  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("approval-filter-all").click();
  await page.getByTestId(`approval-row-${ref.approvalId}`).click();
  await expect(page.getByTestId("approval-status")).toHaveAttribute(
    "data-status",
    "expired",
  );
  await expect(page.getByTestId("approval-approve")).toHaveCount(0);
  await expect(page.getByTestId("approval-reject")).toHaveCount(0);
});

test("only a board admin sees agent control; a PAT cannot decide", async ({
  board,
  page,
  browser,
  admin,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Permission check");
  const pat = await createAgentToken(board, playwright, testIp);
  const ref = await requestCardDelete(pat, board.id, cardId);

  // A PAT may create the request but never decide it.
  const denied = await pat.post(
    `/api/v1/boards/${board.id}/approvals/${ref.approvalId}/decision`,
    {
      data: { decision: "approve", planHash: ref.planHash },
    },
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe("pat_forbidden");

  const member = await createUserViaAdmin(admin, {
    email: uniqueEmail("agent-member"),
    verified: true,
    password: "e2e-password-123",
  });
  const added = await admin.post(`/api/v1/admin/boards/${board.id}/members`, {
    data: { email: member.email, role: "MEMBER" },
  });
  expect(added.ok(), await added.text()).toBe(true);

  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": testIp },
    locale: "en-US",
  });
  const memberPage = await context.newPage();
  try {
    await login(memberPage, {
      email: member.email,
      password: "e2e-password-123",
    });
    await expect(memberPage.getByTestId("account-trigger")).toBeVisible();
    await memberPage.goto(new URL(`board/${board.id}`, appUrl).href);
    await expect(
      memberPage.getByRole("button", { name: "Switch board" }),
    ).toBeVisible();
    await expect(memberPage.getByTestId("agent-control-trigger")).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }

  // The owner still sees it.
  await board.open(page);
  await expect(page.getByTestId("agent-control-trigger")).toBeVisible();
});

test("board pause blocks new agent writes while reads stay available", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Existing card");
  const pat = await createAgentToken(board, playwright, testIp);
  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("agent-pause-tab").click();
  await expect(page.getByTestId("board-pause-status")).toHaveAttribute(
    "data-paused",
    "false",
  );

  await page.getByTestId("board-pause").click();
  await page.getByTestId("board-pause-reason").fill("Release freeze");
  await page.getByTestId("board-pause-confirm").click();
  await expect(page.getByTestId("board-pause-status")).toHaveAttribute(
    "data-paused",
    "true",
  );
  await expect(page.getByTestId("agent-control-dialog")).toContainText(
    "Release freeze",
  );

  const write = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    data: {
      commandId: randomUUID(),
      action: {
        type: "ADD_CARD",
        boardId: board.id,
        columnId: todo,
        newCardId: randomUUID(),
        title: "Must not land",
        at: Date.now(),
      },
    },
  });
  expect(write.status()).toBe(403);
  expect((await write.json()).code).toBe("agent_paused");

  // Reads remain available during a pause.
  expect((await pat.get(`/api/v1/boards/${board.id}`)).status()).toBe(200);

  await page.getByTestId("board-resume").click();
  await page.getByTestId("board-resume-confirm").click();
  await expect(page.getByTestId("board-pause-status")).toHaveAttribute(
    "data-paused",
    "false",
  );
  const retried = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    data: {
      commandId: randomUUID(),
      action: {
        type: "ADD_CARD",
        boardId: board.id,
        columnId: todo,
        newCardId: randomUUID(),
        title: "Landed after resume",
        at: Date.now(),
      },
    },
  });
  expect(retried.status(), await retried.text()).toBe(200);
});

test("session pause blocks only writes carrying that session id", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const pat = await createAgentToken(board, playwright, testIp);
  const started = await pat.post(`/api/v1/boards/${board.id}/agent-sessions`, {
    data: { name: "E2E session", clientName: "Playwright" },
  });
  expect(started.status(), await started.text()).toBe(201);
  const session = (await started.json()) as { id: string };

  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("agent-pause-tab").click();
  const row = page.getByTestId(`agent-session-row-${session.id}`);
  await expect(row).toBeVisible();
  await row.getByTestId("agent-session-pause").click();
  await page.getByTestId("agent-action-reason").fill("Review changes");
  await page.getByTestId("agent-action-confirm").click();
  await expect(row.getByTestId("agent-session-paused")).toBeVisible();

  const blocked = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    headers: { "X-Agent-Session": session.id },
    data: {
      commandId: randomUUID(),
      action: {
        type: "ADD_CARD",
        boardId: board.id,
        columnId: todo,
        newCardId: randomUUID(),
        title: "Blocked by session",
        at: Date.now(),
      },
    },
  });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("agent_paused");

  await row.getByTestId("agent-session-resume").click();
  await page.getByTestId("agent-action-confirm").click();
  await expect(row.getByTestId("agent-session-paused")).toHaveCount(0);
  const allowed = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    headers: { "X-Agent-Session": session.id },
    data: {
      commandId: randomUUID(),
      action: {
        type: "ADD_CARD",
        boardId: board.id,
        columnId: todo,
        newCardId: randomUUID(),
        title: "Allowed after session resume",
        at: Date.now(),
      },
    },
  });
  expect(allowed.status(), await allowed.text()).toBe(200);
  await pat.post(
    `/api/v1/boards/${board.id}/agent-sessions/${session.id}/end`,
    { data: { status: "completed" } },
  );
});

test("stop-all pauses every live token and resume-all keeps individual pauses", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const pat = await createAgentToken(board, playwright, testIp);
  await board.open(page);
  await openAccount(page, "tokens");
  await page.getByTestId("token-stop-all").click();
  await page.getByTestId("stop-all-reason").fill("Incident");
  await page.getByTestId("stop-all-confirm").click();
  await expect(page.getByTestId("token-stop-all-panel")).toHaveAttribute(
    "data-paused",
    "true",
  );

  const write = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    data: {
      commandId: randomUUID(),
      action: {
        type: "RENAME_BOARD",
        boardId: board.id,
        title: "Should not rename",
        at: Date.now(),
      },
    },
  });
  expect(write.status()).toBe(403);
  expect((await write.json()).code).toBe("agent_paused");

  await page.getByTestId("token-stop-all-resume").click();
  await expect(page.getByTestId("token-stop-all-panel")).toHaveAttribute(
    "data-paused",
    "false",
  );
  const retried = await pat.post(`/api/v1/boards/${board.id}/commands`, {
    data: {
      commandId: randomUUID(),
      action: {
        type: "RENAME_BOARD",
        boardId: board.id,
        title: "Renamed after resume",
        at: Date.now(),
      },
    },
  });
  expect(retried.status(), await retried.text()).toBe(200);
});
