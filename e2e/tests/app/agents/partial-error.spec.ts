import { test, expect } from "@/fixtures/board.js";
import { createAgentSession } from "@/helpers/agents.js";
import { appUrl } from "@/helpers/urls.js";

test("keeps last-known sessions and shows a partial error banner", async ({
  page,
  board,
  playwright,
  testIp,
}, testInfo) => {
  const other = await board.api.post("/api/v1/boards", {
    data: { title: `Unavailable ${Date.now()}` },
  });
  expect(other.status(), await other.text()).toBe(201);
  const otherBoard = (await other.json()) as { id: string };

  const column = await board.column("Todo");
  await board.card(column, "Partial error card");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Partial agent",
    sessionName: "Partial session",
  });

  try {
    await board.open(page);
    await page.route(
      `**/api/v1/boards/${otherBoard.id}/agent-sessions`,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "E2E partial failure" }),
        }),
    );

    await page.goto(new URL("agents", appUrl).href);
    await expect(page.getByTestId("agents-page")).toBeVisible();
    await page.getByTestId("agents-section-sessions").click();
    await expect(
      page.getByTestId(`agent-session-row-${agent.session.id}`),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("agents-error")).toContainText(
      "Some boards are unavailable",
    );

    await page.screenshot({
      path: testInfo.outputPath("partial-error.png"),
      fullPage: true,
    });
  } finally {
    await agent.dispose();
    await board.api
      .delete(`/api/v1/boards/${otherBoard.id}`)
      .catch(() => undefined);
  }
});
