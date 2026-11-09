import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/collaboration.js";
import { siteUrl } from "@/helpers/urls.js";

/**
 * W-05: a command issued through a personal API token is attributed to an
 * agent — the feed row wears the agent badge and the Agents rail lists the
 * agent, while the human Online roster does not.
 */
test("labels an agent actor and lists it in Agents", async ({
  page,
  board,
  partner,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();

  const created = await partner.api.post("/api/v1/users/me/tokens", {
    data: { name: "QA agent", expiresAt: null },
  });
  expect(created.status()).toBe(201);
  const { token } = (await created.json()) as { token: string };
  const agent = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: {
      "X-Forwarded-For": testIp,
      Authorization: `Bearer ${token}`,
    },
  });
  try {
    const cardId = randomUUID();
    const command = await agent.post(`/api/v1/boards/${board.id}/commands`, {
      data: {
        commandId: randomUUID(),
        action: {
          boardId: board.id,
          at: Date.now(),
          type: "ADD_CARD",
          newCardId: cardId,
          columnId: todo,
          title: "Agent card",
        },
      },
    });
    expect(command.status(), await command.text()).toBe(200);
  } finally {
    await agent.dispose();
  }

  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();

  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Agent card" });
  await expect(entry).toBeVisible();
  await expect(entry.getByTestId("actor-agent-badge")).toBeVisible();
  await expect(entry).toContainText(partner.user.email);
  await expect
    .poll(async () =>
      Number(await page.getByTestId("watch-agents").textContent()),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("watch-agents-list")).toContainText(
    partner.user.email,
  );
  await expect(page.getByTestId("watch-presence-list")).toContainText(
    board.email,
  );
  await expect(page.getByTestId("watch-presence-list")).not.toContainText(
    partner.user.email,
  );
});
