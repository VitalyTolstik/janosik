import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";

import { test, expect, type BoardFixture } from "@/fixtures/board.js";
import { appUrl } from "@/helpers/urls.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const visualDir = process.env.E2E_EPIC_VISUAL_DIR;

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
  const label = await board.label("Checkout", "blue");
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
      const toggle = activeTile.getByRole("button", { name: /^EPIC\s*EP-/ });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(activeTile).toContainText("1/4");
      await expect(activeTile).toContainText("3 open");
      await expect(activeTile).toContainText("Anna Kowalska");
      await expect(activeTile).toContainText("Dec 12");
      await expect(activeTile).toContainText("Checkout");
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
  await activeTile.getByRole("button", { name: /^EPIC\s*EP-/ }).click();
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
  await expect(rail).toHaveCount(3);
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
  const first = page.getByRole("button", { name: /Scale epic 1\s+\d+\// });
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText("Scale card 1", { exact: true })).toBeVisible();
  const firstChild = card(page, "Scale card 1");
  await firstChild.hover({ position: { x: 32, y: 18 } });
  const childBox = (await firstChild.boundingBox())!;
  const scrollBox = (await scroller.boundingBox())!;
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
    page.getByRole("button", { name: /Scale epic 1\s+\d+\// }),
  ).toBeVisible();
  await expect(page.getByText("Scale card 1", { exact: true })).toBeVisible();
});
