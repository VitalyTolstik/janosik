import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { test, expect } from "@/fixtures/board.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const visualDir = fileURLToPath(
  new URL("../../../../.artifacts/h5/visual/recommended/", import.meta.url),
);
mkdirSync(visualDir, { recursive: true });

async function order(page: import("@playwright/test").Page, testIds: string[]) {
  const boxes: number[] = [];
  for (const id of testIds) {
    const box = await page.getByTestId(id).first().boundingBox();
    expect(box, `${id} is visible`).not.toBeNull();
    boxes.push(box!.x);
  }
  expect(boxes).toEqual([...boxes].sort((a, b) => a - b));
}

async function documentAxe(page: import("@playwright/test").Page) {
  await page.evaluate(axeSource as unknown as () => void);
  const violations = await page.evaluate(async () => {
    const { axe } = window as unknown as {
      axe: typeof import("axe-core");
    };
    return (
      await axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      })
    ).violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    }));
  });
  expect(violations).toEqual([]);
}

async function seedBoard(board: import("@/fixtures/board.js").BoardFixture) {
  await board.command({
    type: "RENAME_BOARD",
    title: "Sprint board 2026-W48",
  });
  const todo = await board.column("Todo");
  await board.column("Done");
  const card = await board.card(todo, "Recommended header card");
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId: card,
    assigneeId: board.userId,
  });
}

test("recommended header and toolbar structure at 1440", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);

  // The right inspector is gone, including its trigger and shortcut target.
  await expect(page.locator('[aria-controls="board-inspector"]')).toHaveCount(
    0,
  );
  await expect(page.locator("#board-inspector")).toHaveCount(0);
  await expect(page.locator(".board-inspector")).toHaveCount(0);
  await expect(page.getByTestId("board-toolbar-menu")).toHaveCount(1);
  await expect(page.getByTestId("board-display-menu")).toHaveCount(0);

  // Row 1 order: brand → title → switcher → presence/People → Agents, then
  // Search → bell → undo → redo → board menu → account.
  await order(page, [
    "brand-home",
    "board-title",
    "board-switcher-trigger",
    "people-trigger",
    "agent-control-trigger",
  ]);
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await order(page, [
    "global-search-trigger",
    "notifications-bell",
    "header-undo",
    "header-redo",
    "board-menu-trigger",
    "account-trigger",
  ]);
  const account = page.getByTestId("account-trigger");
  await expect(account).toContainText(/^[A-Z]{1,2}$/);
  await expect(account).not.toContainText(board.email);
  await expect(account).not.toContainText("Test User");

  // The mock's 1440 topbar has eleven interactive elements.
  expect(
    await page
      .locator("header")
      .first()
      .evaluate(
        (header) =>
          Array.from(
            header.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]'),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              (typeof element.checkVisibility === "function"
                ? element.checkVisibility()
                : element.getClientRects().length > 0),
          ).length,
      ),
  ).toBe(11);

  // Row 2 is one line in the recommended order:
  // search → Filters → saved views → view switcher → Select → overflow.
  await expect(page.getByTestId("saved-views-menu")).toBeVisible();
  expect(
    await page
      .getByTestId("board-toolbar")
      .evaluate((toolbar) =>
        Array.from(toolbar.children).map(
          (child) =>
            (child as HTMLElement).dataset.testid ??
            child.querySelector<HTMLElement>("[data-testid]")?.dataset.testid,
        ),
      ),
  ).toEqual([
    "filter-search-region",
    "saved-views-menu",
    "view-switcher",
    "bulk-select-toggle",
    "board-toolbar-menu",
  ]);
  await order(page, [
    "filter-bar",
    "saved-views-menu",
    "view-switcher",
    "bulk-select-toggle",
    "board-toolbar-menu",
  ]);
  const rowTops = await Promise.all(
    [
      "filter-bar",
      "saved-views-menu",
      "view-switcher",
      "bulk-select-toggle",
      "board-toolbar-menu",
    ].map(async (id) => {
      const box = await page.getByTestId(id).first().boundingBox();
      return Math.round(box!.y);
    }),
  );
  expect(Math.max(...rowTops) - Math.min(...rowTops)).toBeLessThanOrEqual(2);
  const searchBox = await page
    .locator('input[name="filter-search"]')
    .boundingBox();
  expect(searchBox!.width).toBeGreaterThan(300);
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
  const views = page.getByTestId("view-switcher");
  for (const name of ["Board", "Calendar", "Table", "Watch"]) {
    await expect(views.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByTestId("bulk-select-toggle")).toBeVisible();

  // The toolbar overflow is Board appearance only.
  await page.getByTestId("board-toolbar-menu").click();
  const toolbarMenu = page.getByRole("menu").last();
  await expect(toolbarMenu.getByTestId("density-toggle")).toBeVisible();
  await expect(toolbarMenu.getByTestId("glass-blur")).toBeVisible();
  await expect(toolbarMenu.getByTestId("column-style-menu")).toBeVisible();
  await expect(
    toolbarMenu.getByRole("menuitem", { name: "Board settings" }),
  ).toHaveCount(0);
  await expect(
    toolbarMenu.getByRole("menuitem", { name: /Data & backups/ }),
  ).toHaveCount(0);
  await expect(
    toolbarMenu.getByRole("menuitem", { name: /Card archive/ }),
  ).toHaveCount(0);
  await expect(toolbarMenu.getByRole("menuitem", { name: "Help" })).toHaveCount(
    0,
  );
  const toolbarLabels = await toolbarMenu
    .locator('[role^="menuitem"]')
    .allTextContents();
  await page.keyboard.press("Escape");

  // The header Board menu is the low-frequency menu only.
  await page.getByTestId("board-menu-trigger").click();
  const headerMenu = page.getByRole("menu").last();
  await expect(headerMenu.getByTestId("board-settings-trigger")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-data")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-archive")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-help")).toBeVisible();
  await expect(headerMenu.getByTestId("density-toggle")).toHaveCount(0);
  const headerLabels = await headerMenu
    .locator('[role^="menuitem"]')
    .allTextContents();
  expect(headerLabels.filter((label) => toolbarLabels.includes(label))).toEqual(
    [],
  );
  await page.keyboard.press("Escape");

  // No horizontal overflow at the required desktop width.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBe(0);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(
      (value) => localStorage.setItem("janosik-theme", value),
      theme,
    );
    await page.reload();
    await expect(page.getByTestId("board-title")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${theme}\\b`),
    );
    await documentAxe(page);
    await page
      .locator("header")
      .first()
      .screenshot({
        path: `${visualDir}1440-${theme}-header.png`,
        animations: "disabled",
      });
    await page.screenshot({
      path: `${visualDir}1440-${theme}-board.png`,
      animations: "disabled",
    });
  }
});

for (const width of [390, 768, 1024, 1920]) {
  test(`recommended header stays overflow-free and axe-clean at ${width}px`, async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        (value) => localStorage.setItem("janosik-theme", value),
        theme,
      );
      await page.reload();
      await expect(page.getByTestId("board-title")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBe(0);
      await expect(page.locator("#board-inspector")).toHaveCount(0);
      await documentAxe(page);
      await page
        .locator("header")
        .first()
        .screenshot({
          path: `${visualDir}${width}-${theme}-header.png`,
          animations: "disabled",
        });
      await page.screenshot({
        path: `${visualDir}${width}-${theme}-board.png`,
        animations: "disabled",
      });
    }
  });
}

test("People faces still open the roster and dialogs", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const people = page.getByTestId("people-trigger");
  await expect(people.getByTestId("people-avatar").first()).toBeVisible();
  await people.click();
  const menu = page.getByRole("menu", { name: "People" });
  await expect(menu.getByRole("menuitem", { name: "Members" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Share" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Members" }).click();
  await expect(page.getByTestId("board-members-box")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-members-box")).toHaveCount(0);
  await expect(people).toBeFocused();
});

for (const width of [390, 768, 1024, 1440, 1920]) {
  test(`a card click opens the modal at ${width}px`, async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);
    const card = page
      .getByTestId("card-title")
      .filter({ hasText: "Recommended header card" });
    await card.click();
    const editor = page.getByRole("dialog", { name: "Card details" });
    await expect(editor).toBeVisible();
    await expect(page).toHaveURL(/[?&]card=/);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    await expect(page.locator("#board-inspector")).toHaveCount(0);
    await expect(page.locator('[aria-controls="board-inspector"]')).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBe(0);
  });
}
