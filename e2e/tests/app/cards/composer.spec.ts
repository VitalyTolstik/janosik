import { test, expect } from "@/fixtures/board.js";
import { cardOrder, columnSection } from "@/helpers/history.js";

test("keeps the composer open for rapid entry with multiline titles and labels", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.label("Bug");
  await board.open(page);
  const column = columnSection(page, "Todo");
  await column.locator("[data-composer-trigger]").click();
  const composer = column.locator('[name="card-composer"]');

  await composer.fill("Line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Line two");
  await column
    .getByTestId("composer-labels")
    .getByRole("button", { name: "Bug", exact: true })
    .click();
  await expect(
    column
      .getByTestId("composer-labels")
      .getByRole("button", { name: "Bug", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await composer.press("Enter");

  // Enter commits and clears, but the composer stays open for the next card.
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("");
  await composer.fill("Second");
  await composer.press("Enter");
  await composer.fill("Third");
  await composer.press("Enter");
  await composer.press("Escape");
  await expect(composer).toHaveCount(0);

  const order = await cardOrder(page, "Todo");
  expect(order).toHaveLength(3);
  expect(order[0]).toContain("Line one");
  expect(order[0]).toContain("Line two");
  expect(order.slice(1)).toEqual(["Second", "Third"]);
  await expect(column.getByTestId("card-labels").first()).toContainText("Bug");
});
