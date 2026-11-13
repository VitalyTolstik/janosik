import { test, expect } from "@/fixtures/collaboration.js";
import { createAgentSession } from "@/helpers/agents.js";
import { appUrl } from "@/helpers/urls.js";

/**
 * A non-ADMIN board member can read the agent evidence but gets no mutating
 * affordances: the server would answer 403 to pause/resume/end anyway, and the
 * TASK-166 read-only principle says the UI must not offer them (TASK-166.13).
 */
for (const role of ["MEMBER", "VIEWER"] as const) {
  test(`shows a live agent session to a ${role} without controls`, async ({
    page,
    board,
    partner,
    playwright,
    testIp,
  }) => {
    await partner.invite(role);
    await partner.accept();
    const agent = await createAgentSession(playwright, board, testIp, {
      tokenName: `Owner agent ${role}`,
      sessionName: `Owner session ${role}`,
    });
    try {
      await partner.open(page);
      await page.goto(new URL("agents", appUrl).href);
      await expect(page.getByTestId("agents-page")).toBeVisible();
      await page.getByTestId("agents-section-sessions").click();

      const row = page.getByTestId(`agent-session-row-${agent.session.id}`);
      await expect(row).toBeVisible();
      await row.click();

      await expect(
        page.getByTestId("agents-session-detail-hint"),
      ).toBeVisible();
      await expect(page.getByTestId("agents-session-read-only")).toBeVisible();
      await expect(page.getByTestId("agents-session-pause")).toHaveCount(0);
      await expect(page.getByTestId("agents-session-resume")).toHaveCount(0);
      await expect(page.getByTestId("agents-session-end")).toHaveCount(0);
      await expect(page.getByTestId("agents-session-open-board")).toBeVisible();
    } finally {
      await agent.dispose();
    }
  });
}

test("a MEMBER cannot reach the control API directly", async ({
  board,
  partner,
  playwright,
  testIp,
}) => {
  await partner.invite("MEMBER");
  await partner.accept();
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Protected agent",
    sessionName: "Protected session",
  });
  try {
    const paused = await partner.api.post(
      `/api/v1/boards/${board.id}/agent-sessions/${agent.session.id}/pause`,
      { data: { reason: "nope" } },
    );
    expect(paused.status()).toBe(403);
    const ended = await partner.api.post(
      `/api/v1/boards/${board.id}/agent-sessions/${agent.session.id}/end`,
      { data: { status: "cancelled" } },
    );
    expect(ended.status()).toBe(403);
  } finally {
    await agent.dispose();
  }
});
