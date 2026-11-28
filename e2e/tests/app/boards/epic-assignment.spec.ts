import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

import { test, expect } from "@/fixtures/collaboration.js";
import type { BoardFixture } from "@/fixtures/board.js";
import { getBoard } from "@/helpers/boards.js";
import { openFilters, closeFilters, facetCount } from "@/helpers/filters.js";
import {
  closeCardDialog,
  columnSection,
  undoButton,
} from "@/helpers/history.js";
import { openTable, tableRow } from "@/helpers/views.js";

const visualDir = process.env.E2E_E3_VISUAL_DIR;
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const epicTitle = "Checkout reliability and payment retries";
const alphaTitle = "Review recovery copy";
const betaTitle = "Test payment errors";
const childTitle = "Audit duplicate charges";

async function seedAssignments(board: BoardFixture) {
  const backlog = await board.column("Backlog");
  const doing = await board.column("In progress");
  const done = await board.column("Done");
  const epicId = randomUUID();
  const otherId = randomUUID();
  const completedId = randomUUID();
  for (const [position, [id, title]] of [
    [epicId, epicTitle],
    [otherId, "Billing reconciliation"],
    [completedId, "Account cleanup"],
  ].entries()) {
    await board.command({
      type: "ADD_EPIC",
      epic: {
        id,
        title,
        color: "rose",
        status: "active",
        position,
        createdAt: 1,
        updatedAt: 1,
      },
    });
  }
  const alpha = await board.card(doing, alphaTitle);
  const beta = await board.card(doing, betaTitle);
  const child = await board.card(backlog, childTitle);
  const completedChild = await board.card(doing, "Refresh profile settings");
  const finished = await board.card(done, "Check audit events");
  for (const [cardId, id] of [
    [child, epicId],
    [finished, epicId],
    [completedChild, completedId],
  ]) {
    await board.command({ type: "SET_CARD_EPIC", cardId, epicId: id });
  }
  await board.command({
    type: "SET_EPIC_STATUS",
    epicId: completedId,
    status: "completed",
  });
  return { alpha, beta, epicId, otherId, backlog, doing };
}

async function openReleaseBoard(board: BoardFixture, page: Page) {
  const profile = await board.api.patch("/api/v1/users/me", {
    data: { displayName: "Anna Kowalska" },
  });
  expect(profile.ok()).toBe(true);
  await board.command({ type: "RENAME_BOARD", title: "Payments release" });
  await board.open(page);
  await page.addInitScript({ content: axeSource });
  await page.evaluate(axeSource as unknown as () => void);
}

function face(page: Page, title: string) {
  return page
    .locator("article[data-card-href]")
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function capture(page: Page, testInfo: TestInfo, surface: string) {
  const { width } = page.viewportSize()!;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBe(0);
  if (!visualDir || width === 1024) return;
  const theme = await page.evaluate(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  mkdirSync(visualDir, { recursive: true });
  const filename = `${surface}-${width}-${theme}.png`;
  const path = join(visualDir, filename);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(filename, { path, contentType: "image/png" });
}

async function audit(page: Page) {
  const violations = await page.evaluate(async () => {
    // Measure the final colors after any running UI transitions.
    const transitions = document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition);
    await Promise.allSettled(
      transitions.map((transition) => transition.finished),
    );
    const { axe } = window as unknown as { axe: typeof import("axe-core") };
    const { violations } = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, html, failureSummary }) => ({
        target,
        html,
        failureSummary,
      })),
    }));
  });
  expect(violations).toEqual([]);
}

async function openContext(page: Page, title: string, touch: boolean) {
  const card = face(page, title);
  if (touch) await card.getByTestId("board-card-actions").tap();
  else await card.click({ button: "right" });
  await expect(page.getByTestId("card-context-menu")).toBeVisible();
}

for (const width of [390, 1024, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${width}px ${theme} epic assignment`, () => {
      test.use({
        viewport: { width, height: width === 390 ? 844 : 900 },
        hasTouch: width === 390,
        colorScheme: theme,
        reducedMotion: "reduce",
      });

      test("dialog, context menu and bulk edit then undo one card", async ({
        page,
        board,
      }, testInfo) => {
        const { alpha, beta, epicId } = await seedAssignments(board);
        await openReleaseBoard(board, page);
        const membership = async () => {
          const { cards } = await getBoard(board.api, board.id);
          return [cards[alpha]?.epicId ?? null, cards[beta]?.epicId ?? null];
        };
        const alphaCard = face(page, alphaTitle);
        const betaCard = face(page, betaTitle);
        if (width === 390) {
          await alphaCard.evaluate((card) =>
            card
              .closest("section")
              ?.scrollIntoView({ block: "nearest", inline: "start" }),
          );
        }
        const dialog = page.getByRole("dialog", { name: "Card details" });
        const picker = page.getByRole("combobox", {
          name: "Epic",
          exact: true,
        });

        await alphaCard.getByTestId("card-title").click();
        await picker.click();
        const listbox = page.getByRole("listbox", { name: "Epic" });
        await expect(
          listbox.getByRole("option", { name: /Checkout reliability/ }),
        ).toContainText("1/2");
        await expect(listbox.getByText("Account cleanup")).toHaveCount(0);
        if (width === 390)
          expect((await picker.boundingBox())?.height).toBeGreaterThanOrEqual(
            44,
          );
        await capture(page, testInfo, "dialog");
        await audit(page);
        await picker.press("Escape");
        await expect(picker).toBeFocused();
        await expect(dialog).toBeVisible();
        await picker.press("ArrowDown");
        await picker.press("Home");
        await picker.press("Enter");
        await expect(picker).toContainText(epicTitle);
        await expect.poll(membership).toEqual([epicId, null]);
        await picker.click();
        await expect(listbox.getByText("1/3")).toBeVisible();
        await listbox
          .getByRole("option", { name: "No epic", exact: true })
          .click();
        await expect(picker).toContainText("No epic");
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .first()
          .click();
        await expect.poll(membership).toEqual([null, null]);

        await openContext(page, alphaTitle, width === 390);
        await page.getByTestId("ctx-epic-trigger").click();
        const submenu = page.getByTestId("ctx-epic-content");
        await expect(
          submenu.getByRole("menuitem", { name: /Checkout reliability/ }),
        ).toBeVisible();
        await capture(page, testInfo, "context");
        await audit(page);
        await submenu
          .getByRole("menuitem", { name: /Checkout reliability/ })
          .click();
        await expect(page.getByTestId("card-context-menu")).toBeHidden();
        await expect(alphaCard.getByTestId("card-epic-chip")).toContainText(
          epicTitle,
        );
        await expect(
          face(page, "Refresh profile settings").getByTestId("card-epic-chip"),
        ).toHaveCount(0);
        if (width === 390)
          await expect(
            alphaCard.getByTestId("board-card-actions"),
          ).toBeFocused();
        await openContext(page, alphaTitle, width === 390);
        await page.getByTestId("ctx-remove-epic").click();
        await expect(alphaCard.getByTestId("card-epic-chip")).toHaveCount(0);
        await expect.poll(membership).toEqual([null, null]);

        await page.getByTestId("bulk-select-toggle").click();
        await alphaCard.getByTestId("card-title").click();
        await betaCard.getByTestId("card-title").click();
        const bulkEpic = page.getByTestId("bulk-epic");
        if (width === 390) {
          const bounds = (await bulkEpic.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          await expect(bulkEpic).toHaveText("Epic");
        }
        await bulkEpic.click();
        const bulkMenu = page.getByTestId("bulk-epic-menu");
        await expect(bulkMenu).toBeVisible();
        await capture(page, testInfo, "bulk");
        await audit(page);
        await bulkMenu
          .getByRole("menuitem", { name: /Checkout reliability/ })
          .click();
        await expect(page.getByTestId("bulk-status")).toContainText(
          "Changed: 2 of 2.",
        );
        await expect.poll(membership).toEqual([epicId, epicId]);
        await bulkEpic.click();
        await bulkMenu
          .getByRole("menuitem", { name: "Remove from epic" })
          .click();
        await expect.poll(membership).toEqual([null, null]);
        await undoButton(page).click();
        await expect.poll(membership).toEqual([null, epicId]);
      });

      test("epic URL, saved view, title search and sortable table column", async ({
        page,
        board,
      }, testInfo) => {
        const { epicId, otherId } = await seedAssignments(board);
        await openReleaseBoard(board, page);
        const child = face(page, childTitle);
        const filters = await openFilters(page);
        const facet = filters.getByTestId("filter-epic");
        await facet
          .getByRole("textbox", { name: "Search epics" })
          .fill("checkout");
        await expect(
          facet.getByRole("checkbox", { name: "Billing reconciliation" }),
        ).toHaveCount(0);
        const epicOption = facet.getByRole("checkbox", { name: epicTitle });
        await epicOption.click();
        await expect(page).toHaveURL(new RegExp(`f\\.epic=${epicId}`));
        await expect(epicOption).toBeChecked();
        await expect(epicOption).toBeInViewport();
        const count = facetCount(page);
        await expect(count).toBeVisible();
        await expect(count).toHaveText("1");
        await capture(page, testInfo, "filter");
        await audit(page);
        await closeFilters(page);
        await expect(child).toBeVisible();
        await expect(child.getByTestId("card-epic-chip")).toHaveCount(0);
        await expect(face(page, alphaTitle)).toHaveCount(0);
        await page.reload();
        await expect(child).toBeVisible();

        const savedViews = page.getByTestId("saved-views-menu");
        await savedViews.click();
        await page.getByTestId("saved-views-save-current").click();
        await page.getByTestId("saved-views-name").fill("Checkout work");
        await page.getByTestId("saved-views-confirm-save").click();
        const panel = page.getByTestId("saved-views-panel");
        const apply = panel.getByRole("button", {
          name: /Apply view Checkout work/,
        });
        await expect(apply).toBeVisible();
        await capture(page, testInfo, "saved-view");
        await audit(page);
        await page.keyboard.press("Escape");
        await page.getByTestId("filter-reset").click();
        await expect(child).toHaveCount(0);
        await savedViews.click();
        await apply.click();
        await expect(page).toHaveURL(new RegExp(`f\\.epic=${epicId}`));
        await expect(child).toBeVisible();

        await openTable(page);
        await page.getByTestId("table-columns-settings").click();
        await page
          .getByRole("menuitemcheckbox", { name: "Epic", exact: true })
          .click();
        await page.keyboard.press("Escape");
        await expect(
          tableRow(page, childTitle).getByTestId("table-epic"),
        ).toContainText("EP-1");
        await expect(page.getByTestId("table-row")).toHaveCount(2);
        if (width === 390) {
          const scroller = page.getByTestId("table-scroll");
          expect(
            await scroller.evaluate((el) => el.scrollWidth - el.clientWidth),
          ).toBeLessThanOrEqual(1);
        }
        await capture(page, testInfo, "table");
        await audit(page);
        await page.reload();
        await openTable(page);
        await expect(
          page.getByRole("columnheader", { name: "Epic" }),
        ).toBeVisible();
        await page
          .getByRole("columnheader", { name: "Epic" })
          .getByRole("button")
          .click();
        await expect(
          page.getByRole("columnheader", { name: "Epic" }),
        ).toHaveAttribute("aria-sort", "ascending");

        await page.getByTestId("filter-reset").click();
        await page.getByTestId("filter-search-input").fill("checkout");
        await expect(page.getByTestId("table-row")).toHaveCount(2);
        await expect(tableRow(page, childTitle)).toBeVisible();

        const updatedUrl = new URL(page.url());
        updatedUrl.search = `?f.epic=${otherId}`;
        await page.goto(updatedUrl.href);
        await savedViews.click();
        await panel
          .getByRole("button", { name: "Rename view Checkout work" })
          .click();
        await panel.getByTestId("saved-views-update-filters").click();
        await page.keyboard.press("Escape");
        await page.getByTestId("filter-reset").click();
        await savedViews.click();
        await apply.click();
        await expect(page).toHaveURL(new RegExp(`f\\.epic=${otherId}`));
        await savedViews.click();
        await panel
          .getByRole("button", { name: "Delete view Checkout work" })
          .click();
        await panel.getByTestId("saved-views-confirm-delete").click();
        await expect(apply).toHaveCount(0);
      });
      test("viewer sees the assigned epic without assignment controls", async ({
        board,
        partner,
        page,
      }) => {
        await seedAssignments(board);
        await partner.invite("VIEWER");
        await partner.accept();
        await partner.open(page);
        await partner.openBoard(page);
        const card = face(page, "Check audit events");
        await openContext(page, "Check audit events", false);
        await expect(page.getByTestId("ctx-epic-trigger")).toHaveCount(0);
        await expect(page.getByTestId("ctx-remove-epic")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("bulk-select-toggle")).toHaveCount(0);
        await card.getByTestId("card-title").click();
        await expect(page.getByTestId("card-epic-readonly")).toHaveText(
          epicTitle,
        );
        await expect(page.getByTestId("card-epic")).toHaveCount(0);
        await page.evaluate(axeSource as unknown as () => void);
        await audit(page);
      });
    });
  }
}

test("creates an epic in the card dialog and undoes assignment and creation independently", async ({
  page,
  board,
}) => {
  const { alpha } = await seedAssignments(board);
  await board.open(page);
  const card = face(page, alphaTitle);
  const dialog = page.getByRole("dialog", { name: "Card details" });
  const picker = dialog.getByRole("combobox", { name: "Epic" });
  const newEpic = "Webhook recovery";
  await card.getByTestId("card-title").click();
  await picker.click();
  await page.getByRole("option", { name: "+ New epic…", exact: true }).click();
  const title = dialog.getByRole("textbox", { name: "Epic title" });
  await expect(title).toBeFocused();
  await title.press("Escape");
  await expect(picker).toBeFocused();
  await picker.click();
  await page.getByRole("option", { name: "+ New epic…", exact: true }).click();
  await title.fill(newEpic);
  await dialog.getByRole("button", { name: "Create and assign" }).click();
  await expect(picker).toContainText(newEpic);
  await expect
    .poll(
      async () => (await getBoard(board.api, board.id)).cards[alpha]?.epicId,
    )
    .toBeDefined();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(card.getByTestId("card-epic-chip")).toContainText(newEpic);
  await undoButton(page).click();
  await expect(card.getByTestId("card-epic-chip")).toHaveCount(0);
  await expect
    .poll(
      async () => (await getBoard(board.api, board.id)).cards[alpha]?.epicId,
    )
    .toBeUndefined();
  await card.getByTestId("card-title").click();
  await picker.click();
  await expect(
    page.getByRole("option", { name: /Webhook recovery/ }),
  ).toContainText("0/0");
  await picker.press("Escape");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await undoButton(page).click();
  await card.getByTestId("card-title").click();
  await picker.click();
  await expect(
    page.getByRole("option", { name: /Webhook recovery/ }),
  ).toHaveCount(0);
});

for (const scenario of [
  { surface: "dialog", rejectCreate: false },
  { surface: "context", rejectCreate: false },
  { surface: "bulk", rejectCreate: false },
  { surface: "dialog", rejectCreate: true },
  { surface: "bulk", rejectCreate: true },
] as const) {
  const { surface, rejectCreate } = scenario;
  test(`${surface} creation preserves a later epic choice${rejectCreate ? " when creation is refused" : ""}`, async ({
    page,
    board,
  }) => {
    const { alpha, beta, epicId } = await seedAssignments(board);
    await board.open(page);
    const card = face(page, alphaTitle);
    const picker = page.getByRole("combobox", { name: "Epic", exact: true });
    const bulk = surface === "bulk";
    async function openEpicContext() {
      await openContext(page, alphaTitle, false);
      await page.getByTestId("ctx-epic-trigger").click();
      return page.getByTestId("ctx-epic-content");
    }

    const commands: { type: string; cardId?: string; epicId: string }[] = [];
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route(`**/api/v1/boards/${board.id}/commands`, async (route) => {
      const { action } = route.request().postDataJSON();
      if (action.type === "ADD_EPIC") {
        commands.push({ type: action.type, epicId: action.epic.id });
        await createGate;
        if (rejectCreate) {
          await route.fulfill({
            status: 400,
            json: { message: "Invalid epic", field: "action.epic.title" },
          });
          return;
        }
      } else if (action.type === "SET_CARD_EPIC") {
        const { type, cardId, epicId } = action;
        commands.push({ type, cardId, epicId });
      }
      await route.continue();
    });

    try {
      if (surface === "dialog") {
        await card.getByTestId("card-title").click();
        await picker.click();
        await page.getByRole("option", { name: "+ New epic…" }).click();
      } else if (bulk) {
        await page.getByTestId("bulk-select-toggle").click();
        await card.getByTestId("card-title").click();
        await face(page, betaTitle).getByTestId("card-title").click();
        await page.getByTestId("bulk-epic").click();
        await page
          .getByTestId("bulk-epic-menu")
          .getByRole("menuitem", { name: "+ New epic…" })
          .click();
      } else {
        const menu = await openEpicContext();
        await menu.getByRole("menuitem", { name: "+ New epic…" }).click();
      }
      await page
        .getByRole("textbox", { name: "Epic title" })
        .fill("First intent");
      await page.getByRole("button", { name: "Create and assign" }).click();
      await expect
        .poll(() => commands.map(({ type }) => type))
        .toEqual(["ADD_EPIC"]);
      if (surface === "dialog") {
        await picker.click();
        await page.getByRole("option", { name: new RegExp(epicTitle) }).click();
        await expect(picker).toContainText(epicTitle);
      } else {
        const menu = await openEpicContext();
        await menu
          .getByRole("menuitem", { name: new RegExp(epicTitle) })
          .click();
        await expect(card.getByTestId("card-epic-chip")).toContainText(
          epicTitle,
        );
      }
      expect(commands).toHaveLength(1);
    } finally {
      releaseCreate();
    }

    const createdId = commands[0].epicId;
    const assign = (cardId: string, epicId: string) => ({
      type: "SET_CARD_EPIC",
      cardId,
      epicId,
    });
    await expect
      .poll(() => commands)
      .toEqual([
        { type: "ADD_EPIC", epicId: createdId },
        ...(rejectCreate ? [] : [assign(alpha, createdId)]),
        ...(bulk && !rejectCreate ? [assign(beta, createdId)] : []),
        assign(alpha, epicId),
      ]);

    const state = async () => {
      const snapshot = await getBoard(board.api, board.id);
      return {
        alpha: snapshot.cards[alpha]?.epicId,
        beta: snapshot.cards[beta]?.epicId,
        created: snapshot.epics?.some(({ id }) => id === createdId) ?? false,
      };
    };
    await expect.poll(state).toEqual({
      alpha: epicId,
      beta: bulk && !rejectCreate ? createdId : undefined,
      created: !rejectCreate,
    });
    await closeCardDialog(page);
    if (bulk) {
      if (!rejectCreate) {
        await expect(page.getByTestId("bulk-status")).toContainText(
          "Changed: 2 of 2.",
        );
      }
      await page.getByTestId("bulk-select-toggle").click();
    }
    await expect(card.getByTestId("card-epic-chip")).toContainText(epicTitle);
    if (rejectCreate && bulk) {
      await expect(
        face(page, betaTitle).getByTestId("card-epic-chip"),
      ).toHaveCount(0);
    }
    await undoButton(page).click();
    await expect.poll(state).toEqual({
      alpha: rejectCreate ? undefined : createdId,
      beta: bulk && !rejectCreate ? createdId : undefined,
      created: !rejectCreate,
    });
    if (bulk && !rejectCreate) {
      await undoButton(page).click();
      await expect
        .poll(state)
        .toEqual({ alpha: createdId, beta: undefined, created: true });
    }
    if (!rejectCreate) {
      await undoButton(page).click();
      await expect
        .poll(state)
        .toEqual({ alpha: undefined, beta: undefined, created: true });
      await undoButton(page).click();
      await expect
        .poll(state)
        .toEqual({ alpha: undefined, beta: undefined, created: false });
    }
    await expect(undoButton(page)).toBeDisabled();
  });
}

for (const surface of ["dialog", "context", "bulk"]) {
  test(`undo restores the card after a membership move and refused ${surface} creation`, async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { alpha, beta, epicId, backlog, doing } =
      await seedAssignments(board);
    await board.open(page);
    const card = face(page, alphaTitle);
    const picker = page.getByRole("combobox", { name: "Epic", exact: true });
    const source = columnSection(page, "In progress");
    const tile = page.locator(`[data-epic-id="${epicId}"]`);
    const commandUrl = `**/api/v1/boards/${board.id}/commands`;
    const commands: string[] = [];
    let refusedEpicId: string | undefined;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route(commandUrl, async (route) => {
      const { action } = route.request().postDataJSON();
      commands.push(action.type);
      if (action.type === "ADD_EPIC") {
        refusedEpicId = action.epic.id;
        await createGate;
        await route.fulfill({
          status: 400,
          json: { code: "validation_failed", field: "action.epic.title" },
        });
      } else {
        await route.continue();
      }
    });

    try {
      if (surface === "dialog") {
        await card.getByTestId("card-title").click();
        await picker.click();
        await page.getByRole("option", { name: "+ New epic…" }).click();
      } else if (surface === "context") {
        await openContext(page, alphaTitle, false);
        await page.getByTestId("ctx-epic-trigger").click();
        await page.getByRole("menuitem", { name: "+ New epic…" }).click();
      } else {
        await page.getByTestId("bulk-select-toggle").click();
        await card.getByTestId("card-title").click();
        await face(page, betaTitle).getByTestId("card-title").click();
        await page.getByTestId("bulk-epic").click();
        await page.getByRole("menuitem", { name: "+ New epic…" }).click();
      }
      await page
        .getByRole("textbox", { name: "Epic title" })
        .fill("First intent");
      await page.getByRole("button", { name: "Create and assign" }).click();
      await expect.poll(() => commands).toEqual(["ADD_EPIC"]);
      expect(refusedEpicId).toBeDefined();
      if (surface === "dialog") await closeCardDialog(page);
      if (surface === "bulk") {
        await expect(
          face(page, betaTitle).getByTestId("card-epic-chip"),
        ).toContainText("First intent");
        await page.getByTestId("bulk-select-toggle").click();
      }
      await expect(card.getByTestId("card-epic-chip")).toContainText(
        "First intent",
      );

      await tile.scrollIntoViewIfNeeded();
      await card.hover({ position: { x: 32, y: 18 } });
      const start = (await card.boundingBox())!;
      const end = (await tile.boundingBox())!;
      await page.mouse.down();
      await page.mouse.move(start.x + 32, start.y + 28);
      await expect(page.getByTestId("card-drag-overlay")).toBeVisible();
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
        steps: 16,
      });
      await page.mouse.up();
      await expect(source.getByText(alphaTitle, { exact: true })).toHaveCount(
        0,
      );
      expect(commands).toEqual(["ADD_EPIC"]);
    } finally {
      releaseCreate();
    }

    const state = async () => {
      const snapshot = await getBoard(board.api, board.id);
      return {
        column: snapshot.columns.find(({ cardIds }) => cardIds.includes(alpha))
          ?.id,
        membership: snapshot.cards[alpha]?.epicId,
        betaMembership: snapshot.cards[beta]?.epicId,
        created: snapshot.epics?.some(({ id }) => id === refusedEpicId),
      };
    };
    await expect.poll(state).toEqual({
      column: backlog,
      membership: epicId,
      betaMembership: undefined,
      created: false,
    });
    expect(commands).toEqual(["ADD_EPIC", "MOVE_CARD"]);

    const [undone] = await Promise.all([
      page.waitForResponse((response) => {
        const request = response.request();
        if (
          request.method() !== "POST" ||
          !request.url().endsWith(`/boards/${board.id}/commands`)
        )
          return false;
        const { action } = request.postDataJSON();
        return action.type === "MOVE_CARD" && action.inverse === true;
      }),
      undoButton(page).click(),
    ]);
    expect(undone.status(), await undone.text()).toBe(200);
    await expect.poll(state).toEqual({
      column: doing,
      membership: undefined,
      betaMembership: undefined,
      created: false,
    });
    await expect(source.getByText(alphaTitle, { exact: true })).toBeVisible();
    await expect(card.getByTestId("card-epic-chip")).toHaveCount(0);
    await expect(undoButton(page)).toBeDisabled();
  });
}

test("cancelling bulk creation assignments keeps the in-flight card and skips the rest", async ({
  page,
  board,
}) => {
  const { alpha, beta } = await seedAssignments(board);
  await board.open(page);
  const assigned: string[] = [];
  let releaseAssignment!: () => void;
  const assignmentGate = new Promise<void>((resolve) => {
    releaseAssignment = resolve;
  });
  await page.route(`**/api/v1/boards/${board.id}/commands`, async (route) => {
    const { action } = route.request().postDataJSON();
    if (action.type === "SET_CARD_EPIC") {
      assigned.push(action.cardId);
      if (assigned.length === 1) await assignmentGate;
    }
    await route.continue();
  });

  await page.getByTestId("bulk-select-toggle").click();
  await face(page, alphaTitle).getByTestId("card-title").click();
  const betaCard = face(page, betaTitle);
  await betaCard.getByTestId("card-title").click();
  await page.getByTestId("bulk-epic").click();
  await page.getByRole("menuitem", { name: "+ New epic…" }).click();
  try {
    await page
      .getByRole("textbox", { name: "Epic title" })
      .fill("First intent");
    await page.getByRole("button", { name: "Create and assign" }).click();
    await expect.poll(() => assigned).toEqual([alpha]);
    await page.getByTestId("bulk-clear").click();
  } finally {
    releaseAssignment();
  }
  await expect(page.getByTestId("bulk-status")).toContainText(
    "Stopped: 1 of 2 processed.",
  );
  await expect(betaCard.getByTestId("card-epic-chip")).toHaveCount(0);
  const { cards, epics } = await getBoard(board.api, board.id);
  expect(cards[alpha]?.epicId).toBeDefined();
  expect(epics?.some(({ id }) => id === cards[alpha]?.epicId)).toBe(true);
  expect(cards[beta]?.epicId).toBeUndefined();
  expect(assigned).toEqual([alpha]);
});
