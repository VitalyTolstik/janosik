import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import { createUserViaAdmin, uniqueEmail } from "@/helpers/admin.js";
import { openAccount, tokenRequest } from "@/helpers/account.js";
import { appUrl } from "@/helpers/urls.js";
import type { BoardFixture } from "@/fixtures/board.js";

interface CreateUserTokenResponse {
  token: string;
  apiToken: { id: string };
}

interface UserTokenDto {
  id: string;
  name: string;
  scopePreset: string;
  trustedCi: boolean;
  rateLimitPerMinute: number | null;
}

/**
 * TASK-166.15 browser flows:
 * - run history lists PAT runs, previews conflicts and applies a human-only,
 *   all-or-nothing rollback from the Agent control dialog;
 * - the board agent policy is edited/reset with CAS and a stale version is
 *   refused; members and API keys cannot change it;
 * - the API-key owner edits scope/limits, while a PAT cannot call the token
 *   PATCH route.
 */

interface AgentToken {
  pat: APIRequestContext;
  apiTokenId: string;
  token: string;
}

async function openAgentControl(page: Page): Promise<void> {
  await page.getByTestId("agent-control-trigger").click();
  await expect(page.getByTestId("agent-control-dialog")).toBeVisible();
}

async function createAgentToken(
  board: BoardFixture,
  playwright: Parameters<typeof tokenRequest>[0],
  testIp: string,
): Promise<AgentToken> {
  const response = await board.api.post("/api/v1/users/me/tokens", {
    data: {
      name: `E2E agent ${randomUUID()}`,
      expiresAt: null,
      scopePreset: "worker",
      boardId: null,
      trustedCi: false,
      readOnly: false,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as CreateUserTokenResponse;
  return {
    pat: await tokenRequest(playwright, body.token, testIp),
    apiTokenId: body.apiToken.id,
    token: body.token,
  };
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

test.describe.configure({ timeout: 90_000 });

test("run history previews and reverts a PAT batch from the UI", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const agent = await createAgentToken(board, playwright, testIp);

  const created = await agent.pat.post(
    `/api/v1/boards/${board.id}/commands/batch`,
    {
      data: {
        commands: [
          addCardCommand(board.id, todo, "Run card one"),
          addCardCommand(board.id, todo, "Run card two"),
        ],
      },
    },
  );
  expect(created.status(), await created.text()).toBe(200);
  const run = (await created.json()) as { runId: string };
  expect(run.runId).toEqual(expect.any(String));

  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("agent-runs-tab").click();

  const row = page.getByTestId(`agent-run-row-${run.runId}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Batch");
  await expect(page.getByTestId("agent-run-detail")).toBeVisible();
  await expect(page.getByTestId("agent-run-status")).toHaveAttribute(
    "data-status",
    "applied",
  );
  await expect(page.getByTestId("agent-run-commands")).toContainText(
    "ADD_CARD",
  );
  await expect(page.getByTestId("agent-run-commands")).toContainText(
    "Run card one",
  );
  await expect(page.getByTestId("agent-run-can-revert")).toHaveAttribute(
    "data-can-revert",
    "true",
  );

  await page.getByTestId("agent-run-revert-apply").click();
  await expect(page.getByTestId("run-revert-dialog")).toBeVisible();
  await page.getByTestId("run-revert-confirm").click();

  await expect(page.getByTestId("agent-run-status")).toHaveAttribute(
    "data-status",
    "reverted",
  );
  await expect(page.getByTestId("agent-run-reverted-at")).toBeVisible();

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.status()).toBe(200);
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title: string }>;
  };
  expect(
    Object.values(aggregate.cards).some(
      (card) => card.title === "Run card one",
    ),
  ).toBe(false);

  const runs = await board.api.get(`/api/v1/boards/${board.id}/runs`);
  expect(runs.status()).toBe(200);
  const rows = (await runs.json()) as Array<{ id: string; status: string }>;
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: run.runId, status: "reverted" }),
    ]),
  );
});

test("a run deep link includes the board and survives reload and history back", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const agent = await createAgentToken(board, playwright, testIp);
  const created = await agent.pat.post(
    `/api/v1/boards/${board.id}/commands/batch`,
    {
      data: {
        commands: [addCardCommand(board.id, todo, "Deep link card")],
      },
    },
  );
  expect(created.status(), await created.text()).toBe(200);
  const run = (await created.json()) as { runId: string };

  const deepLink = new URL(
    `agents?section=runs&board=${board.id}&run=${run.runId}`,
    appUrl,
  ).href;
  // This test opens the global route directly, so sign in as the board owner
  // first instead of relying on the board modal's own navigation.
  await board.open(page);
  await page.goto(deepLink);
  await expect(page.getByTestId("agent-run-detail")).toBeVisible();
  await expect(page.getByTestId("agent-run-copy-link")).toHaveAttribute(
    "data-copy-url",
    `/agents?section=runs&board=${board.id}&run=${run.runId}`,
  );

  // The detail pane is 352 px wide; the footer helper must keep a readable
  // column and the actions must sit below it, not squeeze it.
  const footer = page.getByTestId("agent-run-detail").locator("footer");
  const helper = await footer.locator("p").first().boundingBox();
  const footerActions = await footer.locator("div").last().boundingBox();
  expect(helper).not.toBeNull();
  expect(footerActions).not.toBeNull();
  expect(helper!.width).toBeGreaterThan(200);
  expect(footerActions!.y).toBeGreaterThanOrEqual(
    helper!.y + helper!.height - 1,
  );

  await page.reload();
  await expect(page.getByTestId("agent-run-detail")).toBeVisible();

  await page.goto(new URL("agents?section=runs", appUrl).href);
  // Let this document finish its boot refresh and list load before navigating
  // again: aborting the refresh in flight rotates the cookie server-side and
  // makes the next document boot anonymous.
  await expect(page.getByTestId(`agents-run-row-${run.runId}`)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(deepLink);
  await expect(page.getByTestId("agent-run-detail")).toBeVisible();

  // `?run=` without `?board=` is not a supported lookup: show recovery, not a
  // page that pretends to know the board.
  await page.goto(new URL(`agents?section=runs&run=${run.runId}`, appUrl).href);
  await expect(page.getByTestId("agents-missing-scope")).toBeVisible();
});

test("an empty board explains that there are no runs yet", async ({
  board,
  page,
}) => {
  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("agent-runs-tab").click();
  await expect(page.getByTestId("agent-runs-empty")).toContainText(
    "No runs yet",
  );
});

test("policy edit, stale-version CAS and reset work from the dashboard", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  await board.open(page);
  await openAgentControl(page);
  await page.getByTestId("agent-open-policy").click();

  await expect(page.getByTestId("agent-policy-version")).toContainText(
    "Policy v1",
  );
  await expect(page.getByTestId("agent-policy-effective-limits")).toContainText(
    "100",
  );

  await page.getByTestId("agent-policy-max-commands").fill("7");
  await page.getByTestId("board-settings-workflow").click();
  await page.getByTestId("board-settings-agents").click();
  await expect(page.getByTestId("agent-policy-max-commands")).toHaveValue("7");
  await page.getByTestId("agent-policy-require-move_to_done").click();
  await page.getByTestId("agent-policy-destructive-option-deny").click();
  await page.getByTestId("agent-policy-save").click();

  await expect(page.getByTestId("agent-policy-version")).toContainText(
    "Policy v2",
  );
  const saved = await board.api.get(`/api/v1/boards/${board.id}/agent-policy`);
  expect(saved.status()).toBe(200);
  const savedBody = (await saved.json()) as {
    policy: {
      destructive: string;
      maxCommandsPerRun: number;
      requireApprovalFor: string[];
    };
    version: number;
  };
  expect(savedBody.version).toBe(2);
  expect(savedBody.policy.destructive).toBe("deny");
  expect(savedBody.policy.maxCommandsPerRun).toBe(7);
  expect(savedBody.policy.requireApprovalFor).toContain("move_to_done");

  // A stale version is refused with the current one.
  const stale = await board.api.patch(
    `/api/v1/boards/${board.id}/agent-policy`,
    { data: { policy: null, version: 1 } },
  );
  expect(stale.status()).toBe(409);
  expect((await stale.json()) as Record<string, unknown>).toMatchObject({
    code: "version_conflict",
    currentVersion: 2,
    details: { currentVersion: 2 },
  });

  // An API key can neither read nor write the control plane.
  const agent = await createAgentToken(board, playwright, testIp);
  const patRead = await agent.pat.get(
    `/api/v1/boards/${board.id}/agent-policy`,
  );
  expect(patRead.status()).toBe(403);
  expect((await patRead.json()) as { code?: string }).toMatchObject({
    code: "pat_forbidden",
  });
  const patWrite = await agent.pat.patch(
    `/api/v1/boards/${board.id}/agent-policy`,
    { data: { policy: null, version: 2 } },
  );
  expect(patWrite.status()).toBe(403);
  expect((await patWrite.json()) as { code?: string }).toMatchObject({
    code: "pat_forbidden",
  });

  // Reset sends policy:null and still increments the version.
  await page.getByTestId("agent-policy-reset").click();
  const resetDialog = page.getByRole("dialog", {
    name: "Reset the agent policy?",
  });
  await resetDialog.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByTestId("agent-policy-version")).toContainText(
    "Policy v3",
  );
  const reset = await board.api.get(`/api/v1/boards/${board.id}/agent-policy`);
  const resetBody = (await reset.json()) as {
    policy: unknown;
    effective: { maxCommandsPerRun: number };
  };
  expect(resetBody.policy).toBeNull();
  expect(resetBody.effective.maxCommandsPerRun).toBe(100);
});

test("a member reads run history and previews conflicts but cannot apply", async ({
  board,
  browser,
  admin,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  const agent = await createAgentToken(board, playwright, testIp);
  const created = await agent.pat.post(
    `/api/v1/boards/${board.id}/commands/batch`,
    {
      data: {
        commands: [addCardCommand(board.id, todo, "Member preview card")],
      },
    },
  );
  expect(created.status(), await created.text()).toBe(200);
  const run = (await created.json()) as { runId: string };

  const member = await createUserViaAdmin(admin, {
    email: uniqueEmail("policy-member"),
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
    // A member gets the runs entry, not the admin control plane.
    await expect(memberPage.getByTestId("agent-control-trigger")).toHaveCount(
      0,
    );
    await expect(memberPage.getByTestId("agent-runs-trigger")).toBeVisible();
    await memberPage.getByTestId("agent-runs-trigger").click();
    await expect(memberPage.getByTestId("agent-control-dialog")).toBeVisible();
    await expect(memberPage.getByTestId("agent-pause-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await memberPage.getByTestId("agent-runs-tab").click();
    await expect(
      memberPage.getByTestId(`agent-run-row-${run.runId}`),
    ).toBeVisible();
    await expect(
      memberPage.getByTestId("agent-run-can-revert"),
    ).toHaveAttribute("data-can-revert", "true");
    await expect(memberPage.getByTestId("agent-run-revert-apply")).toHaveCount(
      0,
    );
    await expect(
      memberPage.getByTestId("agent-run-admin-only-note"),
    ).toBeVisible();
    await expect(memberPage.getByTestId("agent-run-preimages")).toHaveCount(0);
    await expect(memberPage.getByTestId("agent-run-diff")).toHaveCount(0);
    await expect(memberPage.getByTestId("agent-policy-tab")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("the API-key owner edits scope and limits; a PAT cannot", async ({
  board,
  page,
  playwright,
  testIp,
}) => {
  // Keep the final " edited" name under API_TOKEN_NAME_MAX (50).
  const name = `Editable ${randomUUID().slice(0, 8)}`;
  const created = await board.api.post("/api/v1/users/me/tokens", {
    data: {
      name,
      expiresAt: null,
      scopePreset: "worker",
      boardId: null,
      trustedCi: false,
      readOnly: false,
      rateLimitPerMinute: 100,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as CreateUserTokenResponse;
  const agent = await tokenRequest(playwright, body.token, testIp);

  await board.open(page);
  await openAccount(page, "tokens");
  const row = page.getByTestId("token-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("token-effective-scope")).toContainText(
    "Worker scope",
  );
  await row.getByTestId("token-edit").click();

  const dialog = page.getByTestId("token-edit-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("token-edit-name").fill(`${name} edited`);
  await dialog.getByTestId("token-edit-scope-preset").click();
  await page.getByRole("menuitemradio", { name: "Reviewer" }).click();
  await dialog.getByTestId("token-edit-trusted-ci").click();
  await dialog.getByTestId("token-edit-rate").fill("250");
  await dialog.getByTestId("token-edit-save").click();

  await expect(dialog).toBeHidden();
  const edited = page
    .getByTestId("token-row")
    .filter({ hasText: `${name} edited` });
  await expect(edited).toBeVisible();
  await expect(edited.getByTestId("token-effective-scope")).toContainText(
    "Reviewer scope",
  );
  await expect(edited).toContainText("Trusted CI");
  await expect(edited).toContainText("250/min");

  const listed = await board.api.get("/api/v1/users/me/tokens");
  const stored = ((await listed.json()) as UserTokenDto[]).find(
    (token) => token.id === body.apiToken.id,
  );
  expect(stored).toMatchObject({
    name: `${name} edited`,
    scopePreset: "reviewer",
    trustedCi: true,
    rateLimitPerMinute: 250,
  });

  const denied = await agent.patch(
    `/api/v1/users/me/tokens/${body.apiToken.id}`,
    {
      data: { name: "agent edit" },
    },
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()) as { code?: string }).toMatchObject({
    code: "pat_forbidden",
  });
});

test("the token section shows empty and error states", async ({
  page,
  browser,
  createUser,
}) => {
  const fresh = await createUser();
  const context = await browser.newContext({ locale: "en-US" });
  const freshPage = await context.newPage();
  try {
    await login(freshPage, fresh);
    await expect(freshPage.getByTestId("account-trigger")).toBeVisible();
    await openAccount(freshPage, "tokens");
    await expect(freshPage.getByText("No API keys yet")).toBeVisible();

    await freshPage.route("**/api/v1/users/me/tokens", (route) =>
      route.abort("failed"),
    );
    await freshPage.keyboard.press("Escape");
    await openAccount(freshPage, "tokens");
    await expect(
      freshPage.getByText("Could not load your API keys"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
