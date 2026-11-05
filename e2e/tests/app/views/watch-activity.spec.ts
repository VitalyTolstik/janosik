import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";

import { scenarios, type Action } from "@/fixtures/watch-scenarios.js";

for (const scenario of scenarios) {
  test(`watch: ${scenario.name}`, async ({ page, board }) => {
    const ids: Record<string, string> = Object.fromEntries(
      [
        "todo",
        "doing",
        "card-a",
        "card-b",
        "label-a",
        "check-a",
        "item-a",
        "link-a",
      ].map((id) => [id, randomUUID()]),
    );
    const response = await board.api.get("/api/v1/auth/me");
    expect(response.ok()).toBeTruthy();
    const user = (await response.json()) as { id: string; email: string };
    ids["$self"] = user.id;
    const command = (action: Action) =>
      board.command(
        JSON.parse(JSON.stringify(action), (_key, value: unknown) =>
          typeof value === "string" && ids[value] ? ids[value] : value,
        ) as Action,
      );
    await command({
      type: "ADD_COLUMN",
      newColumnId: "todo",
      title: "Todo",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-a",
      columnId: "todo",
      title: "Initial title",
    });
    for (const action of scenario.setup ?? []) await command(action);
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();
    await expect(page.getByTestId("watch-feed")).toBeVisible();
    const matching = page
      .getByTestId("watch-entry")
      .filter({ hasText: scenario.message });
    const previousCount = await matching.count();
    await command(scenario.action);
    await expect(matching).toHaveCount(previousCount + 1, { timeout: 15000 });
    const entry = page
      .getByTestId("watch-entry")
      .filter({ hasText: scenario.message })
      .first();
    await expect(entry).toBeVisible({ timeout: 15000 });
    await expect(entry).toContainText(user.email);
    const feedResponse = await board.api.get(
      `/api/v1/boards/${board.id}/activity`,
    );
    expect(feedResponse.ok()).toBeTruthy();
    const feed = (await feedResponse.json()) as {
      items: { type: string; source: string; actorId: string }[];
    };
    expect(
      feed.items.find((item) => item.type === scenario.action.type),
    ).toMatchObject({ source: "command", actorId: user.id });
    if (scenario.diff) {
      await expect(entry.locator(".line-through")).toHaveText(scenario.diff[0]);
      await expect(entry).toContainText(
        `${scenario.diff[0]}→${scenario.diff[1]}`,
      );
    }
  });
}
