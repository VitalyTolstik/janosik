import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";

import { test, expect, type BoardFixture } from "@/fixtures/board.js";
import { openBoardAppearance } from "@/helpers/header.js";
import { columnSection, undoButton } from "@/helpers/history.js";
import { appUrl } from "@/helpers/urls.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const visualDir = process.env.E2E_EPIC_VISUAL_DIR;
const labelName = "Release readiness";

function epic(
  title: string,
  position: number,
  fields?: { ownerId: string; dueDate: number },
) {
  return {
    id: randomUUID(),
    title,
    color: "rose",
    status: "active",
    position,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...fields,
  };
}

async function seedEpics(board: BoardFixture) {
  const profile = await board.api.patch("/api/v1/users/me", {
    data: { displayName: "Anna Kowalska" },
  });
  expect(profile.ok()).toBe(true);
  await board.command({ type: "RENAME_BOARD", title: "Release backlog" });
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  const label = await board.label(labelName, "blue");
  const active = epic("Checkout reliability and payment retries", 0, {
    ownerId: board.userId,
    dueDate: Date.UTC(2026, 11, 12, 12),
  });
  const completed = epic("Tax settings", 1);
  await board.command({ type: "ADD_EPIC", epic: active });
  await board.command({ type: "ADD_EPIC", epic: completed });
  const add = async (columnId: string, title: string, epicId?: string) => {
    const newCardId = randomUUID();
    await board.command({
      type: "ADD_CARD",
      columnId,
      title,
      newCardId,
      epicId,
      labelIds: epicId === active.id ? [label] : [],
    });
    return newCardId;
  };
  await add(backlog, "Retry declined payments", active.id);
  await add(backlog, "Add a checkout timeout", active.id);
  await add(doing, "Refresh retry metrics", active.id);
  await add(done, "Document retry policy", active.id);
  await add(backlog, "Update tax help text", completed.id);
  await board.command({
    type: "SET_EPIC_STATUS",
    epicId: completed.id,
    status: "completed",
  });
  await add(backlog, "Review confirmation copy");
  const incoming = await add(doing, "Indicate pending payments");
  return { active, completed, backlog, incoming };
}

function tile(page: Page, id: string) {
  return page.locator(`[data-epic-id="${id}"]`);
}

function disclosure(epicTile: Locator) {
  return epicTile.getByRole("button", { name: /^(Expand|Collapse) / });
}

function card(page: Page, title: string) {
  return page.locator("article[data-card-href]").filter({
    has: page.getByTestId("card-title").filter({ hasText: title }),
  });
}

async function axeBoard(page: Page) {
  await page.evaluate(axeSource as unknown as () => void);
  const violations = await page.evaluate(async () => {
    const { axe } = window as unknown as { axe: typeof import("axe-core") };
    const { violations } = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    }));
  });
  expect(violations).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, filename: string) {
  if (!visualDir) return;
  mkdirSync(visualDir, { recursive: true });
  const path = join(visualDir, filename);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(filename, { path, contentType: "image/png" });
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${width}px ${theme}: epic layout, persistence and axe`, async ({
      page,
      board,
    }, testInfo) => {
      const { active, completed } = await seedEpics(board);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await board.open(page);
      const activeTile = tile(page, active.id);
      const toggle = disclosure(activeTile);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(activeTile).toContainText("1/4");
      await expect(activeTile).toContainText("3 open");
      await expect(activeTile).toContainText("Anna Kowalska");
      await expect(activeTile).toContainText("Dec 12");
      await expect(
        activeTile.getByText(labelName, { exact: true }),
      ).toBeVisible();
      await expect(activeTile).toHaveCSS("height", "112px");
      expect(
        (
          await activeTile
            .getByRole("button", { name: /Epic menu/ })
            .boundingBox()
        )?.width,
      ).toBeGreaterThanOrEqual(44);
      await expect(page.getByText("Retry declined payments")).toHaveCount(0);
      await expect(page.getByText("Update tax help text")).toBeVisible();
      await expect(page.getByTestId("column-wip").first()).toHaveText("4");
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);

      await capture(page, testInfo, `backlog-${width}-${theme}-collapsed.png`);
      await axeBoard(page);
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const children = page.getByRole("group", {
        name: `Subtasks of ${active.title}`,
      });
      await expect(toggle).toHaveAttribute(
        "aria-controls",
        (await children.getAttribute("id"))!,
      );
      await expect(page.getByText("Retry declined payments")).toBeVisible();
      await expect(
        page.getByText("1 in progress · 1 done in other columns"),
      ).toBeVisible();
      const menu = activeTile.getByRole("button", { name: /Epic menu/ });
      await menu.click();
      await expect(
        page.getByRole("dialog", { name: /Cards in Checkout/ }),
      ).toContainText("Document retry policy");
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      const add = page.getByRole("button", { name: "Add subtask" });
      expect((await add.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      const scroller = page.getByTestId("column-card-scroll").first();
      expect(await scroller.evaluate((el) => el.scrollWidth)).toBe(
        await scroller.evaluate((el) => el.clientWidth),
      );
      await capture(page, testInfo, `backlog-${width}-${theme}-expanded.png`);
      await axeBoard(page);
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("Retry declined payments")).toBeVisible();
      await toggle.click();
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      const fold = page.getByRole("button", { name: "Completed 1" });
      await fold.click();
      await expect(tile(page, completed.id)).toContainText("1 open");
      await expect(page.getByText("Update tax help text")).toBeVisible();
    });
  }
}

async function dragTo(page: Page, source: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await source.hover({ position: { x: 32, y: 18 } });
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(from.x + 32, from.y + 26);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 16,
  });
  await page.mouse.up();
}

function nextCommand(page: Page, type: string) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      response.url().endsWith("/commands") &&
      request.postDataJSON()?.action?.type === type
    );
  });
}

function watchCommands(page: Page) {
  const actions: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/commands")) {
      actions.push(request.postDataJSON()?.action);
    }
  });
  return actions;
}

test("drop on a tile, sort among siblings, drag out, and add a subtask in single commands", async ({
  page,
  board,
}) => {
  const { active, backlog, incoming } = await seedEpics(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const activeTile = tile(page, active.id);

  const intoEpic = nextCommand(page, "MOVE_CARD");
  await dragTo(page, card(page, "Indicate pending payments"), activeTile);
  const moved = await intoEpic;
  expect(moved.ok()).toBe(true);
  expect(moved.request().postDataJSON().action).toMatchObject({
    cardId: incoming,
    toColumnId: backlog,
    epicId: active.id,
  });
  await expect(card(page, "Indicate pending payments")).toHaveCount(0);
  await disclosure(activeTile).click();
  const incomingCard = card(page, "Indicate pending payments");
  const rail = page.locator(`[data-epic-child="${active.id}"]`);
  await expect(rail).toHaveCount(3);

  const sort = nextCommand(page, "MOVE_CARD");
  await dragTo(page, incomingCard, card(page, "Retry declined payments"));
  const reordered = await sort;
  expect(reordered.ok()).toBe(true);
  expect(reordered.request().postDataJSON().action).not.toHaveProperty(
    "epicId",
  );
  await expect(rail.first()).toContainText("Indicate pending payments");

  const outOfEpic = nextCommand(page, "MOVE_CARD");
  await dragTo(page, incomingCard, page.getByTestId("backlog-other"));
  const detached = await outOfEpic;
  expect(detached.ok()).toBe(true);
  expect(detached.request().postDataJSON().action).toMatchObject({
    cardId: incoming,
    toColumnId: backlog,
    epicId: null,
  });
  await expect(rail).toHaveCount(2);
  await expect(incomingCard).toBeVisible();

  const reattach = nextCommand(page, "MOVE_CARD");
  await undoButton(page).click();
  const undone = await reattach;
  expect(undone.ok()).toBe(true);
  expect(undone.request().postDataJSON().action).toMatchObject({
    cardId: incoming,
    epicId: active.id,
  });
  await expect(rail.first()).toContainText("Indicate pending payments");
  await page.reload();
  await expect(rail).toHaveCount(3);
  await expect(rail.first()).toContainText("Indicate pending payments");

  await page.getByRole("button", { name: "Add subtask" }).click();
  const editor = page.getByRole("textbox", {
    name: /New subtask for Checkout/,
  });
  await editor.fill("Write a retry migration");
  const add = nextCommand(page, "ADD_CARD");
  await editor.press("Enter");
  const created = await add;
  expect(created.ok()).toBe(true);
  expect(created.request().postDataJSON().action).toMatchObject({
    title: "Write a retry migration",
    columnId: backlog,
    epicId: active.id,
  });
  await page.keyboard.press("Escape");
  await expect(rail).toHaveCount(4);
});

test("keyboard drag sorts epic siblings", async ({ page, board }) => {
  const { active } = await seedEpics(board);
  await board.open(page);
  await disclosure(tile(page, active.id)).click();
  const siblings = page.locator(`[data-epic-child="${active.id}"]`);
  const source = siblings.first().getByRole("group", {
    name: "Retry declined payments",
  });
  await source.focus();
  await page.keyboard.press("Space");
  const overlay = page.getByTestId("card-drag-overlay");
  await expect(overlay).toBeVisible();
  const start = (await overlay.boundingBox())!.y;
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () => (await overlay.boundingBox())?.y)
    .toBeGreaterThan(start + 50);
  const move = nextCommand(page, "MOVE_CARD");
  await page.keyboard.press("Space");
  const result = await move;
  expect(result.ok()).toBe(true);
  expect(result.request().postDataJSON().action).not.toHaveProperty("epicId");
  await expect(siblings.first()).toContainText("Add a checkout timeout");
  await expect(siblings.last()).toContainText("Retry declined payments");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an epic tile respects the Backlog WIP limit", async ({ page, board }) => {
  const { active, backlog } = await seedEpics(board);
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: backlog,
    wipLimit: 4,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const commands = watchCommands(page);
  await dragTo(
    page,
    card(page, "Indicate pending payments"),
    tile(page, active.id),
  );
  await expect(
    page.getByRole("status").filter({
      hasText: /“Backlog” is at its WIP limit \(4\)/,
    }),
  ).toBeVisible();
  await expect(
    columnSection(page, "Doing").getByText("Indicate pending payments", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(tile(page, active.id)).toContainText("1/4");
  expect(commands).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`${width}px compact epic geometry`, async ({
    page,
    board,
  }, testInfo) => {
    const { active, completed } = await seedEpics(board);
    await page.setViewportSize({ width, height: 844 });
    await board.open(page);
    await openBoardAppearance(page);
    await page.getByTestId("density-toggle").click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-density",
      "compact",
    );
    await page.keyboard.press("Escape");

    const activeTile = tile(page, active.id);
    await disclosure(activeTile).click();
    await page.getByRole("button", { name: "Completed 1" }).click();
    await expect(activeTile.locator("..")).toHaveCSS("height", "64px");
    await expect(
      page.locator(`[data-epic-child="${active.id}"]`).first(),
    ).toHaveCSS("height", "56px");
    await expect(
      page.getByRole("button", { name: "Add subtask" }).locator(".."),
    ).toHaveCSS("height", "44px");
    await expect(tile(page, completed.id).locator("..")).toHaveCSS(
      "height",
      "56px",
    );

    const title = (await activeTile
      .getByText(active.title, { exact: true })
      .boundingBox())!;
    const progress = (await activeTile
      .getByText("1/4", { exact: true })
      .boundingBox())!;
    const bounds = (await activeTile.boundingBox())!;
    expect(title.height).toBeLessThanOrEqual(24);
    expect(title.y + title.height).toBeLessThanOrEqual(progress.y);
    expect(progress.y + progress.height).toBeLessThan(bounds.y + bounds.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await capture(page, testInfo, `backlog-${width}-compact.png`);
  });
}

test("a zero-result filter shows the normal empty state in Backlog", async ({
  page,
  board,
}) => {
  await seedEpics(board);
  await board.open(page);
  await page
    .getByTestId("filter-search-input")
    .fill("No epic or card has this title");
  const backlog = columnSection(page, "Backlog");
  await expect(backlog.getByText("No cards match the filter")).toBeVisible();
  await expect(backlog.getByTestId("column-wip")).toHaveText("0");
  await expect(backlog.getByTestId("backlog-epic")).toHaveCount(0);
  await expect(backlog.getByTestId("backlog-other")).toHaveCount(0);
  await expect(backlog.getByRole("button", { name: "Add a card" })).toHaveCount(
    0,
  );
});

test("Backlog composers retain focus through rapid entry and keep drafts across scrolling", async ({
  page,
  board,
}) => {
  const { active, backlog } = await seedEpics(board);
  for (let index = 1; index <= 40; index++) {
    await board.card(backlog, `Filler card ${index}`);
  }
  await board.open(page);
  const scroller = columnSection(page, "Backlog").getByTestId(
    "column-card-scroll",
  );
  await disclosure(tile(page, active.id)).click();
  const addSubtask = page.getByRole("button", { name: "Add subtask" });
  await addSubtask.click();
  const subtask = page.getByRole("textbox", {
    name: /New subtask for Checkout/,
  });
  for (let index = 1; index <= 6; index++) {
    const title = `Rapid subtask ${index}`;
    await subtask.fill(title);
    const add = nextCommand(page, "ADD_CARD");
    await subtask.press("Enter");
    const result = await add;
    expect(result.ok()).toBe(true);
    expect(result.request().postDataJSON().action).toMatchObject({
      title,
      epicId: active.id,
    });
    await expect(subtask).toBeFocused();
    await expect(subtask).toHaveValue("");
  }
  await subtask.fill("Keep the subtask draft");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    scroller.getByText("Filler card 40", { exact: true }),
  ).toBeInViewport();
  await expect(subtask).toHaveValue("Keep the subtask draft");
  await expect(subtask).toBeFocused();
  const subtaskAdd = nextCommand(page, "ADD_CARD");
  await subtask.press("Enter");
  expect((await subtaskAdd).ok()).toBe(true);
  await expect(subtask).toBeFocused();
  await expect(addSubtask).toBeInViewport();
  await subtask.press("Escape");
  await expect(subtask).toHaveCount(0);
  await expect(addSubtask).toBeFocused();
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await disclosure(tile(page, active.id)).click();

  const gap = scroller.getByTestId("card-insert-zone-2");
  await gap.hover();
  await gap.getByRole("button", { name: "Add a card" }).click();
  const inline = page
    .getByRole("dialog", { name: "Add a card" })
    .locator("textarea");
  await inline.fill("Keep the inline draft");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    scroller.getByText("Filler card 40", { exact: true }),
  ).toBeInViewport();
  await expect(gap).toHaveCount(1);
  await expect(inline).toHaveValue("Keep the inline draft");
  await expect(inline).toBeFocused();
  const inlineAdd = nextCommand(page, "ADD_CARD");
  await inline.press("Enter");
  const result = await inlineAdd;
  expect(result.ok()).toBe(true);
  expect(result.request().postDataJSON().action).toMatchObject({
    title: "Keep the inline draft",
    atIndex: 2,
  });
  await expect(inline).toBeFocused();
  await expect(card(page, "Update tax help text")).toBeInViewport();
  await inline.press("Escape");
  await expect(inline).toHaveCount(0);
  const created = scroller.getByText("Keep the inline draft", { exact: true });
  await created.scrollIntoViewIfNeeded();
  await expect(created).toBeInViewport();
});

test.describe("390px touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("long-press drag attaches, detaches and auto-scrolls", async ({
    page,
    board,
  }) => {
    const { active, backlog } = await seedEpics(board);
    for (let index = 1; index <= 24; index++) {
      await board.card(backlog, `Touch filler ${index}`);
    }
    await board.open(page);
    const source = card(page, "Review confirmation copy");
    const activeTile = tile(page, active.id);
    const scroller = columnSection(page, "Backlog").getByTestId(
      "column-card-scroll",
    );
    const overlay = page.getByTestId("card-drag-overlay");
    const commands = watchCommands(page);
    const session = await page.context().newCDPSession(page);

    async function lift(scroll = true) {
      if (scroll) await source.scrollIntoViewIfNeeded();
      const { x, y } = (await source.boundingBox())!;
      const start = { x: x + 32, y: y + 18 };
      const pressedAt = performance.now();
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      // The dnd-kit sensor activates after 220 ms and the Base UI menu opens
      // after 500 ms. Waiting 300 ms leaves ~80 ms for activation and ~200 ms
      // to move before the menu opens.
      await page.waitForTimeout(300);
      return { start, pressedAt };
    }

    async function move(
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) {
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: from.x + ((to.x - from.x) * step) / 8,
              y: from.y + ((to.y - from.y) * step) / 8,
            },
          ],
        });
      }
    }

    async function drop(target: Locator) {
      await source.scrollIntoViewIfNeeded();
      const { x, y, width, height } = (await target.boundingBox())!;
      const { start, pressedAt } = await lift(false);
      await move(start, { x: x + width / 2, y: y + height / 2 });
      await expect(overlay).toBeVisible();
      expect(performance.now() - pressedAt).toBeGreaterThanOrEqual(210);
      const command = nextCommand(page, "MOVE_CARD");
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const result = await command;
      expect(result.ok()).toBe(true);
      await expect(overlay).toHaveCount(0);
      return result.request().postDataJSON().action;
    }

    const attached = await drop(activeTile);
    expect(attached).toMatchObject({ toColumnId: backlog, epicId: active.id });
    await expect(activeTile).toContainText("1/5");
    await expect(source).toHaveCount(0);
    await disclosure(activeTile).tap();
    await expect(
      source.locator("xpath=ancestor::li[@data-epic-child]"),
    ).toHaveCount(1);

    const detached = await drop(page.getByTestId("backlog-other"));
    expect(detached).toMatchObject({
      cardId: attached.cardId,
      toColumnId: backlog,
      epicId: null,
    });
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(activeTile).toContainText("1/4");
    await expect(
      source.locator("xpath=ancestor::li[@data-epic-child]"),
    ).toHaveCount(0);
    await disclosure(activeTile).tap();

    await source.scrollIntoViewIfNeeded();
    const before = await scroller.evaluate((element) => element.scrollTop);
    const scrollBox = (await scroller.boundingBox())!;
    const { start, pressedAt } = await lift(false);
    await move(start, { x: start.x, y: scrollBox.y + scrollBox.height - 16 });
    await expect(overlay).toBeVisible();
    expect(performance.now() - pressedAt).toBeGreaterThanOrEqual(210);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(before + 100);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(overlay).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(commands).toEqual([attached, detached]);
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await source.scrollIntoViewIfNeeded();
    const sourceBox = (await source.boundingBox())!;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: sourceBox.x + 32, y: sourceBox.y + 18 }],
    });
    const menu = page.getByTestId("card-context-menu");
    await expect(menu).toBeVisible();
    await expect(overlay).toHaveCount(0);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect(commands).toEqual([attached, detached]);
    await source.tap();
    await expect(
      page.getByRole("dialog", { name: "Card details" }),
    ).toBeVisible();
  });
});

test("1,000 cards and 100 epics keep both ends reachable through the mixed window", async ({
  page,
  board,
}) => {
  const epics = Array.from({ length: 100 }, (_, index) =>
    epic(`Scale epic ${index + 1}`, index),
  );
  const cards = Array.from({ length: 1_000 }, (_, index) => ({
    id: randomUUID(),
    title: `Scale card ${index + 1}`,
    labelIds: [],
    ...(index < 400 ? { epicId: epics[0].id } : {}),
    createdAt: 1,
    updatedAt: 1,
  }));
  const snapshot = {
    id: randomUUID(),
    title: "Epic window scale",
    columns: [
      {
        id: randomUUID(),
        title: "Backlog",
        cardIds: cards.map(({ id }) => id),
        createdAt: 1,
      },
    ],
    cards: Object.fromEntries(cards.map((item) => [item.id, item])),
    epics,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const response = await board.api.post("/api/v1/boards/import", {
    data: {
      app: "janosik",
      schemaVersion: 4,
      exportedAt: Date.now(),
      boards: [snapshot],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const [{ id }] = (await response.json()) as Array<{ id: string }>;
  await board.open(page);
  await page.goto(new URL(`board/${id}`, appUrl).href);

  const scroller = page.getByTestId("column-card-scroll");
  const first = page.getByRole("button", { name: /^Expand.*Scale epic 1\b/ });
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText("Scale card 1", { exact: true })).toBeVisible();
  const firstChild = card(page, "Scale card 1");
  await firstChild.hover({ position: { x: 32, y: 18 } });
  const childBox = (await firstChild.boundingBox())!;
  const scrollBox = (await scroller.boundingBox())!;
  const commands = watchCommands(page);
  await page.mouse.down();
  await page.mouse.move(childBox.x + 32, childBox.y + 26);
  await page.mouse.move(
    scrollBox.x + 120,
    scrollBox.y + scrollBox.height - 15,
    { steps: 12 },
  );
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("card-drag-overlay")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const fraction of [0.2, 0.45, 0.8, 1]) {
    await scroller.evaluate((el, percent) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * percent;
    }, fraction);
    await expect
      .poll(() =>
        scroller.evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          return [...el.querySelectorAll("article,[data-epic-id]")].some(
            (row) => {
              const rect = row.getBoundingClientRect();
              return rect.top < bounds.bottom && rect.bottom > bounds.top;
            },
          );
        }),
      )
      .toBe(true);
    expect(
      await scroller.locator("article,[data-epic-id]").count(),
    ).toBeLessThan(30);
  }
  await expect(
    page.getByText("Scale card 1000", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-composer-trigger]")).toBeVisible();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: /^Collapse.*Scale epic 1\b/ }),
  ).toBeVisible();
  await expect(page.getByText("Scale card 1", { exact: true })).toBeVisible();
  expect(commands).toEqual([]);
});
