import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster, ownerCredentials } from "@/helpers/admin.js";

/**
 * TASK-181.7 final browser matrix for the admin Filters surface.
 *
 * The behavioural coverage lives in card-filter-bar.spec.ts,
 * content-filters.spec.ts and moderation-filters.spec.ts. This file produces
 * the EN/RU screenshots at 1440, 1024 and 390 and proves the page never gains
 * horizontal overflow on the narrow viewport.
 */

const copy = {
  en: { filters: "Filters", dialog: "Filters for cards" },
  ru: { filters: "Фильтры", dialog: "Фильтры карточек" },
} as const;

for (const locale of ["en", "ru"] as const) {
  for (const width of [1440, 1024, 390] as const) {
    test(`filter surface at ${width}px, ${locale}`, async ({ page, board }) => {
      const todo = await board.column("Todo");
      const cardId = await board.card(todo, "Filter acceptance card");
      const labelId = await board.label("Acceptance", "green");
      await board.command({
        type: "SET_CARD_LABEL",
        cardId,
        labelId,
        on: true,
      });

      await loginAsMaster(page, ownerCredentials());
      await page.setViewportSize({ width, height: 900 });
      const query = new URLSearchParams({
        tab: "cards",
        boardId: board.id,
        labelId,
        status: "active",
        period: "7d",
        returnTo: "/admin",
      });
      if (locale === "ru") query.set("lng", "ru");
      await page.goto(adminPath(`boards?${query.toString()}`));

      const trigger = page.getByRole("button", {
        name: new RegExp(`^${copy[locale].filters}(?: \\d+)?$`),
      });
      await expect(trigger).toBeVisible();
      await expect(page.getByTestId(`admin-card-row-${cardId}`)).toBeVisible();
      await expect(page.getByTestId("admin-filter-boardId")).toBeVisible();
      await expect(page.getByTestId("admin-filter-labelId")).toBeVisible();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      await page.screenshot({
        path: test.info().outputPath(`filters-${locale}-${width}.png`),
        fullPage: false,
      });

      if (width === 390) {
        await trigger.click();
        const dialog = page.getByRole("dialog", {
          name: copy[locale].dialog,
        });
        await expect(dialog).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`filters-${locale}-${width}-sheet.png`),
          fullPage: false,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
    });
  }
}
