import { type Page } from "@playwright/test";
import { test as boardTest, expect } from "./board.js";

type ContextCard = {
  id: string;
  relatedId: string;
  openMenu: () => Promise<void>;
  openSubmenu: (name: string) => Promise<void>;
};

export const test = boardTest.extend<{ contextCard: ContextCard }>({
  contextCard: async ({ page, board }, use) => {
    const columnId = await board.column("Work");
    const id = await board.card(columnId, "Context task");
    const relatedId = await board.card(columnId, "Related task");
    await board.open(page);
    await use({
      id,
      relatedId,
      openMenu: async () => openMenu(page),
      openSubmenu: async (name) => {
        await openMenu(page);
        await page.getByTestId(`ctx-${name}-trigger`).hover();
        await expect(page.getByTestId(`ctx-${name}-content`)).toBeVisible();
      },
    });
  },
});

async function openMenu(page: Page) {
  for (
    let i = 0;
    i < 3 && (await page.getByTestId("card-context-menu").isVisible());
    i++
  ) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("card-context-menu")).toHaveCount(0);
  await page
    .getByTestId("card-title")
    .filter({ hasText: /^Context task$/ })
    .click({ button: "right" });
  await expect(page.getByTestId("card-context-menu")).toBeVisible();
}

export { expect };
