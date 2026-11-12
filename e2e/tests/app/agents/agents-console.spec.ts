import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import { createAgentSession, readAgentSession } from "@/helpers/agents.js";
import { appUrl } from "@/helpers/urls.js";

/**
 * TASK-166.13: the agents console. The server exposes sessions per board, so
 * the page merges every board, filters client-side and drives the TASK-166.3
 * pause/resume and the board-ADMIN end flow.
 */

async function openAgents(page: import("@playwright/test").Page) {
  await page.goto(new URL("agents", appUrl).href);
  await expect(page.getByTestId("agents-page")).toBeVisible();
  await page.getByTestId("agents-section-sessions").click();
}

test("lists a live session, filters it and opens the detail", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Fix the queue");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "QA agent",
    sessionName: "Nightly triage",
    currentCardId: card,
  });
  try {
    await board.open(page);
    await page.getByTestId("agent-control-trigger").click();
    await page.getByTestId("agent-control-all-agents").click();
    await expect(page.getByTestId("agents-page")).toBeVisible();
    await expect(page.getByTestId("agents-trigger")).toBeFocused();
    const railHeading = await page
      .getByRole("heading", { name: "Agents", exact: true })
      .boundingBox();
    const pageHeading = await page
      .getByRole("heading", { name: "Attention", exact: true })
      .boundingBox();
    expect(railHeading).not.toBeNull();
    expect(pageHeading).not.toBeNull();
    expect(Math.abs(railHeading!.y - pageHeading!.y)).toBeLessThanOrEqual(1);

    await page.getByTestId("agents-section-sessions").click();
    const row = page.getByTestId(`agent-session-row-${agent.session.id}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(board.title);
    await expect(row).toContainText("Nightly triage");
    await expect(row).toContainText("Fix the queue");
    await expect(page.getByTestId("agents-session-group-toggle")).toContainText(
      "1 live",
    );

    // Status filter: the active session stays, a completed one would not.
    await page.getByTestId("agents-filter-status").click();
    await page.getByTestId("agents-filter-status-option-active").click();
    await expect(row).toBeVisible();

    // Board filter: the same row under the only board.
    await page.getByTestId("agents-filter-board").click();
    await page.getByTestId(`agents-filter-board-option-${board.id}`).click();
    await expect(row).toBeVisible();

    await row.click();
    await expect(page.getByTestId("agents-session-detail-hint")).toContainText(
      "Agent writes are allowed",
    );
    await expect(page.getByTestId("agents-session-pause")).toBeVisible();
    await expect(page.getByTestId("agents-session-end")).toBeVisible();
    await expect(page.getByTestId("agents-session-open-board")).toBeVisible();
    await expect(
      page.getByTestId("agents-session-token-settings"),
    ).toBeVisible();
  } finally {
    await agent.dispose();
  }
});

test("keeps the shell usable on mobile and restores focus after API keys", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await board.open(page);
  await openAgents(page);
  const scopeBox = await page.getByTestId("agents-header-scope").boundingBox();
  const accountBox = await page.getByTestId("account-trigger").boundingBox();
  expect(scopeBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(Math.abs(scopeBox!.y - accountBox!.y)).toBeLessThan(12);
  await expect(page.getByTestId("agents-section-sessions")).toHaveAttribute(
    "aria-current",
    "page",
  );
  const createKey = page.getByRole("button", { name: "Create API key" });
  await createKey.click();
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(createKey).toBeFocused();
  await page.getByTestId("agents-section-runs").click();
  await expect(page.getByTestId("agents-runs-empty")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("pauses and resumes a session with a reason", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Pausable agent",
    sessionName: "Pausable session",
  });
  try {
    await board.open(page);
    await openAgents(page);
    await page.getByTestId(`agent-session-row-${agent.session.id}`).click();
    await expect(page.getByTestId("agents-session-detail-hint")).toBeVisible();

    await page.getByTestId("agents-session-pause").click();
    await expect(page.getByRole("dialog").last()).toContainText(
      "Pause this agent session?",
    );
    await page.getByTestId("agent-action-reason").fill("Stop the loop");
    await page.getByTestId("agent-action-confirm").click();
    await expect(
      page.getByTestId("agent-pause-badge-session").first(),
    ).toBeVisible();
    await expect(page.getByTestId("agents-session-resume")).toBeVisible();
    const paused = await readAgentSession(
      board.api,
      board.id,
      agent.session.id,
    );
    expect(paused.paused).toBe(true);
    expect(paused.pausedReason).toBe("Stop the loop");

    await page.getByTestId("agents-session-resume").click();
    await page.getByTestId("agent-action-confirm").click();
    await expect(page.getByTestId("agents-session-pause")).toBeVisible();
    const resumed = await readAgentSession(
      board.api,
      board.id,
      agent.session.id,
    );
    expect(resumed.paused).toBe(false);
  } finally {
    await agent.dispose();
  }
});

test("ends a session with a final status and hides its controls", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Finishing agent",
    sessionName: "Finishing session",
  });
  try {
    await board.open(page);
    await openAgents(page);
    await page.getByTestId(`agent-session-row-${agent.session.id}`).click();
    await page.getByTestId("agents-session-end").click();
    await expect(page.getByRole("dialog").last()).toContainText(
      "End this agent session?",
    );
    await page.getByTestId("agent-action-summary").fill("Queue drained");
    await page.getByTestId("agent-action-confirm").click();

    await expect(
      page.getByTestId("agent-status-completed").first(),
    ).toBeVisible();
    await expect(page.getByTestId("agents-session-end")).toHaveCount(0);
    const ended = await readAgentSession(board.api, board.id, agent.session.id);
    expect(ended.status).toBe("completed");
    expect(ended.endedAt).not.toBeNull();
    expect(ended.summary).toBe("Queue drained");
  } finally {
    await agent.dispose();
  }
});

test("shows the empty state and then follows a new session over SSE", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  await board.open(page);
  await openAgents(page);
  await expect(page.getByTestId("agents-empty")).toBeVisible();

  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "SSE agent",
    sessionName: "SSE session",
  });
  try {
    // No reload: the `agent.started` frame refreshes the affected board.
    await expect(
      page.getByTestId(`agent-session-row-${agent.session.id}`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("agents-empty")).not.toBeVisible();
  } finally {
    await agent.dispose();
  }
});

test("surfaces a failed session request and retries it", async ({
  page,
  board,
}) => {
  await board.open(page);
  await page.route("**/api/v1/boards/*/agent-sessions", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "E2E failure" }),
    }),
  );
  await openAgents(page);
  await expect(page.getByTestId("agents-error")).toBeVisible();
  await expect(page.getByTestId("agents-error")).toContainText(
    "Could not load agent sessions",
  );

  await page.unroute("**/api/v1/boards/*/agent-sessions");
  await page.getByTestId("agents-retry").click();
  await expect(page.getByTestId("agents-empty")).toBeVisible();
});

test("attributes an agent command in Watch with its token and session", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Watch agent",
    sessionName: "Watch session",
  });
  try {
    await agent.command({
      type: "ADD_CARD",
      newCardId: randomUUID(),
      columnId: column,
      title: "Agent card",
    });
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();

    const entry = page
      .getByTestId("watch-entry")
      .filter({ hasText: "Agent card" });
    await expect(entry).toBeVisible();
    await expect(entry.getByTestId("agent-attribution-name")).toHaveText(
      "Watch agent",
    );
    await expect(
      entry.getByTestId("agent-attribution-session"),
    ).toHaveAttribute("title", `session: ${agent.session.id}`);
    await expect(
      page.getByTestId("watch-agents-list").filter({ hasText: "Watch agent" }),
    ).toBeVisible();
  } finally {
    await agent.dispose();
  }
});
