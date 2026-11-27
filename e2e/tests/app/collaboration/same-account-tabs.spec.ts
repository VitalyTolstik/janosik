import { test, expect } from "@/fixtures/board.js";
import { addCard } from "@/helpers/collaboration.js";
import { cardTitle, columnSection } from "@/helpers/history.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

test("a second tab of the same account applies its commands once and dedupes presence", async ({
  page,
  context,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);

  const second = await context.newPage();
  await second.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    second.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  await expect(columnSection(second, "Todo")).toBeVisible();

  // Solo user: both tabs share one presence identity — never "+1" for my
  // own second tab. The People entry itself stays visible (H1).
  await expect(page.getByTestId("people-overflow")).toHaveCount(0);
  await expect(second.getByTestId("people-overflow")).toHaveCount(0);

  await addCard(second, "Todo", "Tab card");
  await expect(cardTitle(page, "Tab card")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(cardTitle(second, "Tab card")).toHaveCount(1);
  await page.waitForTimeout(1_500);
  await expect(cardTitle(page, "Tab card")).toHaveCount(1);
  await expect(page.getByTestId("people-overflow")).toHaveCount(0);

  await second.close();
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("people-overflow")).toHaveCount(0);
  await expect(cardTitle(page, "Tab card")).toHaveCount(1);
});
