import { test, expect } from "@/fixtures/collaboration.js";
import { columnSection } from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

test("a column accent and the board shape appear in the other context", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);

  await columnSection(page, "Todo").getByTestId("column-style-trigger").click();
  await page.getByTestId("column-style-option-brand").click();

  await expect(columnSection(partnerBrowser.page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "brand",
    { timeout: 5000 },
  );

  await page.getByTestId("board-display-menu").click();
  await page.getByTestId("column-style-menu").click();
  await page.getByTestId("column-style-menu-band").click();
  await page.keyboard.press("Escape");

  await expect(columnSection(partnerBrowser.page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "band",
    { timeout: 5000 },
  );
  await expect(columnSection(partnerBrowser.page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "brand",
  );

  // The API aggregate is the source of truth for the shared shape.
  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    columns: Array<{ id: string; accent?: { type: string; value: string } }>;
    columnStyle?: string;
  };
  expect(aggregate.columnStyle).toBe("band");
  expect(
    aggregate.columns.find((column) => column.id === todo)?.accent,
  ).toEqual({ type: "color", value: "brand" });
});
