import { test, expect } from "@/fixtures/board.js";
import { globalSearchInput, globalSearchOption } from "@/helpers/search.js";

for (const width of [390, 1024, 1440]) {
  test(`uses palette commands and search with the keyboard at ${width}px`, async ({
    page,
    board,
  }) => {
    const column = await board.column("Todo");
    await board.card(column, "Release checklist");
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);

    const keyboard = page.keyboard;
    const opener = page.getByTestId("brand-home");
    const shortcut = width === 1024 ? "Meta+k" : "Control+k";
    const input = globalSearchInput(page);
    const openPalette = async () => {
      await keyboard.press(shortcut);
      await expect(input).toBeFocused();
    };

    await keyboard.press("Tab");
    await expect(opener).toBeFocused();
    await openPalette();
    await keyboard.type(">");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await keyboard.press("Escape");
    await expect(input).toBeHidden();
    await expect(opener).toBeFocused();

    await openPalette();
    await keyboard.type("> compact");
    await keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute(
      "data-density",
      "compact",
    );
    await expect(opener).toBeFocused();

    await openPalette();
    await keyboard.type("> switch view");
    await keyboard.press("Enter");
    const views = page.getByRole("listbox", { name: "Switch view" });
    await expect(views.getByRole("option")).toHaveCount(4);
    await keyboard.press("ArrowDown");
    await keyboard.press("ArrowDown");
    await expect(views.getByRole("option", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Table" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openPalette();
    await keyboard.type("> filters");
    await keyboard.press("Enter");
    const filters = page.getByTestId("filters-popover");
    await expect(filters).toBeVisible();
    await expect(filters.locator(":focus")).toHaveCount(1);
    await keyboard.press("Escape");
    await expect(filters).toBeHidden();
    await expect(page.getByTestId("filter-facets-trigger")).toBeFocused();

    await openPalette();
    await keyboard.type("> export");
    await keyboard.press("Enter");
    const data = page.getByRole("menu", { name: "Data & backups" });
    await expect(
      data.getByRole("menuitem", { name: "Export this board" }),
    ).toBeVisible();
    await keyboard.press("Escape");
    await expect(data).toBeHidden();
    await expect(page.getByTestId("board-menu-trigger")).toBeFocused();

    await openPalette();
    await keyboard.type(">");
    await keyboard.press("Backspace");
    await expect(input).toHaveAccessibleName("Search cards and boards");
    await keyboard.type("Release checklist");
    await expect(globalSearchOption(page, "Release checklist")).toBeVisible();
  });
}
