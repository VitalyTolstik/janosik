import type { Locator } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster, ownerCredentials } from "@/helpers/admin.js";

test.use({ serviceWorkers: "block" });

async function expectUnclipped(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeInViewport({ ratio: 0.99 });
  await expect
    .poll(() =>
      control.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    )
    .toBe(true);
}

for (const width of [1440, 1024, 390]) {
  test(`card due-date picker and native fallback fit at ${width}px`, async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const columnId = await board.column("Calendar checks");
    const cardId = await board.card(columnId, "Calendar checks");
    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath(`cards/${cardId}`));

    const due = page.getByTestId("admin-card-due-input");
    // Below sm the picker renders inline under the trigger; wider widths keep
    // the Radix popover (role=dialog).
    const picker =
      width < 640
        ? page.getByTestId("admin-card-due-input-panel")
        : page.getByRole("dialog");
    await due.press("Enter");
    await picker.scrollIntoViewIfNeeded();
    await expectUnclipped(picker.getByRole("grid"));
    await expect(picker.getByRole("listbox")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(due).toBeFocused();

    const calendarChunk = /\/assets\/calendar-[^/]+\.js$/;
    await page.route(calendarChunk, (route) => route.abort());
    await page.reload();
    const failedChunk = page.waitForEvent("requestfailed", {
      predicate: (request) => calendarChunk.test(request.url()),
    });
    await due.press("Enter");
    await failedChunk;
    await picker.scrollIntoViewIfNeeded();

    const alert = picker.getByRole("alert");
    const retry = picker.getByRole("button", {
      name: "Retry date and time picker",
    });
    const native = picker.getByLabel("Due date and time");
    await expect(alert).toContainText(
      "The date and time picker could not load.",
    );
    await expectUnclipped(picker);
    await expectUnclipped(retry);
    await expectUnclipped(native);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
    await expect(retry).toBeFocused();
    const retryFailed = page.waitForEvent("console", {
      predicate: (message) =>
        message.text().startsWith("Date and time picker failed:"),
    });
    await page.keyboard.press("Enter");
    await retryFailed;
    await expect(retry).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(native).toBeFocused();
    await expect(picker.getByRole("listbox")).toHaveCount(0);
    await expect(picker.getByRole("grid")).toHaveCount(0);
    await expect(page.getByTestId("admin-card-title-input")).toBeEditable();

    await native.fill("2027-04-06T18:43");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(due).toBeFocused();
    await page.getByTestId("admin-card-due-save").click();
    await expect(page.getByTestId("admin-card-due-remove")).toBeEnabled();
  });
}
