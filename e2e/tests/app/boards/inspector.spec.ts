import { test, expect } from "@/fixtures/board.js";
import { globalSearchInput } from "@/helpers/search.js";

for (const { width, mode, dockWidth } of [
  { width: 390, mode: "sheet", dockWidth: 0 },
  { width: 768, mode: "drawer", dockWidth: 0 },
  { width: 1024, mode: "drawer", dockWidth: 0 },
  { width: 1440, mode: "dock", dockWidth: 360 },
  { width: 1680, mode: "dock", dockWidth: 360 },
  { width: 1920, mode: "dock", dockWidth: 400 },
]) {
  test(`opens the ${mode} inspector at ${width}px without document overflow`, async ({
    page,
    board,
  }) => {
    for (const name of ["Backlog", "Ready", "In progress", "Review", "Done"]) {
      await board.column(name);
    }
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);

    const toggle = page.locator('[aria-controls="board-inspector"]');
    const panel = page.locator(".board-inspector");
    const main = page.getByTestId("board-main");
    const measure = async () => (await main.boundingBox())!.width;
    const noDocumentOverflow = async () => {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      expect(
        await page
          .locator("header")
          .first()
          .evaluate((header) => header.scrollWidth),
      ).toBeLessThanOrEqual(width);
    };
    const closedWidth = await measure();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#board-inspector")).toHaveCount(1);
    await expect(panel).toBeHidden();
    await noDocumentOverflow();
    const target = width < 1024 ? 44 : 32;
    expect(await toggle.boundingBox()).toMatchObject({
      width: target,
      height: target,
    });

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-mode", mode);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(measure).toBe(closedWidth - dockWidth);
    await noDocumentOverflow();

    if (mode === "dock") {
      await expect(
        page.getByRole("complementary", { name: "Inspector" }),
      ).toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(panel.getByRole("separator")).toBeVisible();
      expect((await panel.boundingBox())!.width).toBe(dockWidth);
      await toggle.click();
    } else {
      await expect(
        page.getByRole("dialog", { name: "Inspector" }),
      ).toHaveAttribute("aria-modal", "true");
      await expect(panel.getByRole("separator")).toHaveCount(0);
      const bounds = await panel.boundingBox();
      expect(bounds?.width).toBeCloseTo(mode === "sheet" ? 390 : 360);
      expect(bounds?.height).toBeCloseTo(mode === "sheet" ? 765 : 900);
      for (let index = 0; index < 8; index += 1) {
        await page.keyboard.press("Tab");
        await expect(panel.locator(":focus")).toHaveCount(1);
      }
      await page.keyboard.press("Escape");
    }

    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect.poll(measure).toBe(closedWidth);
    await page.keyboard.press("BracketRight");
    await expect(panel.getByRole("tab", { name: "People" })).toBeFocused();

    if (mode === "dock") {
      await page.keyboard.press("BracketRight");
      await expect(panel).toBeHidden();
      await page.keyboard.press("BracketRight");
      await expect(panel).toBeVisible();
      await page.reload();
      await expect(panel).toBeVisible();
      await expect.poll(measure).toBe(closedWidth - dockWidth);
    } else {
      await page.keyboard.press("BracketRight");
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
      await page.keyboard.press("BracketRight");
      await expect(panel).toBeVisible();
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toBeHidden();
    }
    await noDocumentOverflow();
  });
}

test("resizes the dock without changing column widths or losing scroll access", async ({
  page,
  board,
}) => {
  for (const name of ["Backlog", "Ready", "In progress", "Review", "Done"]) {
    await board.column(name);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await board.open(page);
  const main = page.getByTestId("board-main");
  const columns = main.locator("[data-column-accent]");
  await expect(columns).toHaveCount(5);
  const columnWidth = (await columns.first().boundingBox())!.width;

  await page.getByRole("button", { name: "Show people panel" }).click();
  const handle = page.getByRole("separator", { name: "Resize inspector" });
  const { x, y, width } = (await handle.boundingBox())!;
  await page.mouse.move(x + width / 2, y + 80);
  await page.mouse.down();
  await page.mouse.move(x - 92, y + 80, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "456");
  expect((await columns.first().boundingBox())!.width).toBe(columnWidth);
  await columns.last().scrollIntoViewIfNeeded();
  await expect(columns.last()).toBeInViewport({ ratio: 0.98 });

  await handle.focus();
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  const resetHandle = (await handle.boundingBox())!;
  const resetX = resetHandle.x + resetHandle.width / 2;
  await page.mouse.move(resetX, y + 80);
  await page.mouse.down();
  await page.mouse.move(resetX - 32, y + 80, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "392");
  expect((await main.boundingBox())!.width).toBe(1048);
});

test("moves focus with the inspector across the dock breakpoint", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const toggle = page.locator('[aria-controls="board-inspector"]');
  const panel = page.locator(".board-inspector");
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(panel).toHaveAttribute("data-mode", "drawer");
  await expect(panel).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel).toHaveAttribute("data-mode", "dock");
  await expect(panel.getByRole("tab", { name: "People" })).toBeFocused();
});

test("persists dismissal when the open dock becomes a drawer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const toggle = page.locator('[aria-controls="board-inspector"]');
  const panel = page.locator(".board-inspector");
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(panel).toHaveAttribute("data-mode", "drawer");
  const scrim = page.locator(".inspector-scrim");
  await scrim.click({ position: { x: 20, y: 300 } });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const key = `janosik-board-panels:v1:${board.userId}:${board.id}`;
  const savedOpen = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).right.open,
    key,
  );
  expect(savedOpen).toBe(false);
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

for (const dismissWith of ["Close", "Escape"]) {
  test(`can dismiss the card with ${dismissWith} after the dock becomes a drawer`, async ({
    page,
    board,
  }) => {
    const column = await board.column("Todo");
    await board.card(column, "Release checklist");
    await page.setViewportSize({ width: 1440, height: 900 });
    await board.open(page);
    await page.getByRole("button", { name: "Show people panel" }).click();
    await page
      .getByTestId("card-title")
      .filter({ hasText: "Release checklist" })
      .click();
    const editor = page.getByRole("dialog", { name: "Card details" });
    await expect(editor).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.locator(".inspector-scrim")).toHaveCount(0);
    await expect(editor).toBeVisible();

    if (dismissWith === "Close") {
      await editor.getByRole("button", { name: "Close", exact: true }).click();
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(editor).toBeHidden();
    const drawer = page.getByRole("dialog", { name: "Inspector" });
    await expect(drawer).toHaveAttribute("data-mode", "drawer");
    await expect(drawer).toBeFocused();
    await drawer.getByRole("button", { name: "Close inspector" }).click();
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Show people panel" }),
    ).toBeFocused();
  });
}

test("closes the bottom sheet before reopening a card from browser history", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "Release checklist");
  await page.setViewportSize({ width: 390, height: 900 });
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Release checklist" })
    .click();
  const editor = page.getByRole("dialog", { name: "Card details" });
  await expect(editor).toBeVisible();
  await page.goBack();
  await expect(editor).toBeHidden();

  const toggle = page.getByRole("button", { name: "Show people panel" });
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "Inspector" });
  await expect(sheet).toBeVisible();
  await page.goForward();
  await expect(editor).toBeVisible();
  await expect(page.locator(".inspector-scrim")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sheet).toBeHidden();
});

test("disables the inspector toggle during a card drag", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "Release checklist");
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);

  const toggle = page.getByRole("button", { name: "Show people panel" });
  const card = page
    .getByTestId("card-title")
    .filter({ hasText: "Release checklist" });
  const { x, y, width, height } = (await card.boundingBox())!;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 16, centerY, { steps: 4 });
  await expect(toggle).toBeDisabled();
  await page.keyboard.press("BracketRight");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.mouse.up();
  await expect(toggle).toBeEnabled();
});

test.describe("touch inspector", () => {
  test.use({ hasTouch: true });

  test("keeps a 44px toggle and hides docking resize on touch", async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await board.open(page);
    const toggle = page.getByRole("button", { name: "Show people panel" });
    expect(await toggle.boundingBox()).toMatchObject({ width: 44, height: 44 });
    await toggle.tap();
    await expect(
      page.getByRole("complementary", { name: "Inspector" }),
    ).toBeVisible();
    await expect(
      page.getByRole("separator", { name: "Resize inspector" }),
    ).toBeHidden();
  });
});

test("hands off to Members and Share, then restores focus through both Escape levels", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await board.open(page);
  const toggle = page.getByRole("button", { name: "Show people panel" });
  await toggle.click();
  const inspector = page.locator(".board-inspector");
  const members = inspector.getByRole("button", {
    name: "Members",
    exact: true,
  });
  const share = inspector.getByRole("button", { name: "Share", exact: true });
  await members.click();
  await expect(page.getByTestId("board-members-box")).toBeVisible();
  const membersDialog = page.getByRole("dialog", { name: /Members/ });
  await membersDialog.getByTestId("dialog-close").focus();
  await page.keyboard.press("BracketRight");
  await expect(membersDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(members).toBeFocused();

  await share.click();
  const shareDialog = page.getByRole("dialog", { name: "Share this board" });
  await expect(shareDialog).toBeVisible();
  await shareDialog.getByTestId("dialog-close").focus();
  await page.keyboard.press("BracketRight");
  await expect(shareDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(share).toBeFocused();
  await expect(inspector).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("opens from the command palette and yields to a card modal", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "Release checklist");
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const panel = page.locator(".board-inspector");
  const input = globalSearchInput(page);

  await page.keyboard.press("Control+k");
  await input.fill("> inspector");
  await page.getByRole("option", { name: "Toggle people panel" }).click();
  await expect(panel.getByRole("tab", { name: "People" })).toBeFocused();

  await page.getByText("Release checklist", { exact: true }).click();
  await expect(panel).toHaveAttribute("inert", "");
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("Control+k");
  await input.fill("> inspector");
  await expect(
    page.getByRole("option", { name: "Toggle people panel" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog").filter({ hasText: "Release checklist" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toHaveAttribute("inert");
  await expect(panel).toBeVisible();
});
