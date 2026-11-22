import { test, expect } from "@/fixtures/board.js";
import { createAgentSession } from "@/helpers/agents.js";

/**
 * TASK-177.6: the attention inbox is not a read-only log. Each board-scoped
 * row must carry the same real deep link people share by hand, so following
 * a blocked-agent letter lands on the exact card; read and read-all stay
 * explicit actions and never fire as a side effect of navigation.
 */
test("attention rows deep-link to the card and mark read explicitly", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Blocked card");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Attention agent",
    sessionName: "Blocker session",
    currentCardId: card,
  });
  try {
    for (const text of ["Blocked on review", "Blocked on deploy"]) {
      const response = await agent.api.post(`/api/v1/cards/${card}/comments`, {
        headers: { "X-Agent-Session": agent.session.id },
        data: { text, kind: "blocker" },
      });
      expect(response.status(), await response.text()).toBe(201);
    }

    await board.open(page);
    const bell = page.getByTestId("notifications-bell");
    await expect(bell).toHaveAccessibleName("Notifications (2 unread)");
    await bell.click();

    const rows = page.getByTestId("attention-item");
    await expect(rows).toHaveCount(2);
    const link = rows.first().getByTestId("attention-link");
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`/board/${board.id}\\?card=${card}$`),
    );

    // Following the link opens the card dialog and closes the popover; the
    // row itself is still unread because opening is not acknowledgement.
    await link.click();
    await expect(page.getByTestId("invitations-panel")).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Card details" }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("card")).toBe(card);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Card details" }),
    ).toBeHidden();

    await bell.click();
    await page
      .getByTestId("attention-item")
      .first()
      .getByRole("button", { name: "Mark as read" })
      .click();
    await expect(bell).toHaveAccessibleName("Notifications (1 unread)");

    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(page.getByTestId("notifications-badge")).toHaveCount(0);
  } finally {
    await agent.dispose();
  }
});
