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
    await page.getByTestId("agents-trigger").click();
    await expect(page.getByTestId("agents-page")).toBeVisible();

    const row = page.getByTestId("agent-row").filter({ hasText: "QA agent" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(board.title);
    await expect(row).toContainText("Nightly triage");
    await expect(row).toContainText("Fix the queue");
    await expect(row).toContainText("1 live");
    await expect(page.getByTestId("agents-stat-agents")).toHaveText("1");
    await expect(page.getByTestId("agents-stat-live")).toHaveText("1");

    // Status filter: the active session stays, a completed one would not.
    await page.getByTestId("agents-filter-status").click();
    await page.getByTestId("agents-filter-status-option-active").click();
    await expect(row).toBeVisible();

    // Board filter: the same row under the only board.
    await page.getByTestId("agents-filter-board").click();
    await page.getByTestId(`agents-filter-board-option-${board.id}`).click();
    await expect(row).toBeVisible();

    await row.click();
    await expect(page.getByTestId("agent-detail-page")).toBeVisible();
    await expect(page.getByTestId("agent-detail-name")).toHaveText("QA agent");
    const session = page.getByTestId("agent-session");
    await expect(session).toContainText("Nightly triage");
    await expect(session).toContainText("playwright");
    await expect(session).toContainText("e2e-model");
    await expect(session).toContainText("Fix the queue");
    await expect(page.getByTestId("agent-session-pause")).toBeVisible();
    await expect(page.getByTestId("agent-session-end")).toBeVisible();
  } finally {
    await agent.dispose();
  }
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
    await page
      .getByTestId("agent-row")
      .filter({ hasText: "Pausable agent" })
      .click();
    await expect(page.getByTestId("agent-detail-page")).toBeVisible();

    await page.getByTestId("agent-session-pause").click();
    await expect(page.getByRole("dialog")).toContainText(
      "Pause this agent session?",
    );
    await page.getByTestId("agent-action-reason").fill("Stop the loop");
    await page.getByTestId("agent-action-confirm").click();
    await expect(page.getByTestId("agent-pause-badge-session")).toBeVisible();
    await expect(page.getByTestId("agent-session-resume")).toBeVisible();
    const paused = await readAgentSession(
      board.api,
      board.id,
      agent.session.id,
    );
    expect(paused.paused).toBe(true);
    expect(paused.pausedReason).toBe("Stop the loop");

    await page.getByTestId("agent-session-resume").click();
    await page.getByTestId("agent-action-confirm").click();
    await expect(page.getByTestId("agent-session-pause")).toBeVisible();
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
    await page
      .getByTestId("agent-row")
      .filter({ hasText: "Finishing agent" })
      .click();
    await page.getByTestId("agent-session-end").click();
    await expect(page.getByRole("dialog")).toContainText(
      "End this agent session?",
    );
    await page.getByTestId("agent-action-summary").fill("Queue drained");
    await page.getByTestId("agent-action-confirm").click();

    await expect(page.getByTestId("agent-status-completed")).toBeVisible();
    await expect(page.getByTestId("agent-session-end")).toHaveCount(0);
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
      page.getByTestId("agent-row").filter({ hasText: "SSE session" }),
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
