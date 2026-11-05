import { test, expect } from "@/fixtures/board.js";

for (const operation of ["claim", "release"] as const) {
  test(`watch shows a card ${operation}`, async ({ page, board }) => {
    const column = await board.column("Todo");
    const card = await board.card(column, "Task");
    const response = await board.api.get("/api/v1/auth/me");
    expect(response.ok()).toBeTruthy();
    const { id, email } = (await response.json()) as {
      id: string;
      email: string;
    };
    const claim = {
      type: "CLAIM_CARD",
      cardId: card,
      claimedBy: id,
      leaseUntil: Date.now() + 60000,
    };
    if (operation === "release") await board.command(claim);
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();
    await expect(page.getByTestId("watch-feed")).toBeVisible();
    await board.command(
      operation === "claim"
        ? claim
        : {
            type: "CLAIM_CARD",
            cardId: card,
            claimedBy: null,
            leaseUntil: null,
          },
    );
    const entry = page.getByTestId("watch-entry").filter({
      hasText:
        operation === "claim" ? "Claimed this card" : "Released the claim",
    });
    await expect(entry).toContainText(email, { timeout: 15000 });
    if (operation === "release")
      await expect(entry.locator(".line-through").first()).toHaveText(email);
  });
}
