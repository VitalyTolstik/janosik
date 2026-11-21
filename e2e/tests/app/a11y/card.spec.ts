import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { type Page } from "@playwright/test";

import { expect, test, type BoardFixture } from "@/fixtures/board.js";

/**
 * Card/board accessibility (U-04, TASK-177.15) in a real browser.
 *
 * The unit suite runs axe with `color-contrast` disabled (jsdom cannot paint)
 * and checks the token pairs arithmetically. This spec is the other half: axe
 * with colour contrast enabled, in light and dark, at phone, tablet and
 * desktop widths, across every board projection and the settings dialog.
 */

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

type AxeNode = {
  target: Array<string | string[]>;
  html?: string;
};

type AxeResult = {
  id: string;
  nodes: AxeNode[];
};

type AxeResults = {
  violations: AxeResult[];
  incomplete: AxeResult[];
};

async function axeIssues(page: Page, context?: string) {
  // Evaluate the source through the DevTools protocol rather than injecting a
  // <script>: the app's CSP only allows same-origin scripts, while CDP
  // evaluation is not subject to it.
  await page.evaluate(axeSource as unknown as () => void);
  return page.evaluate(
    async ({ selector }) => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Document | Element,
              options: unknown,
            ) => Promise<AxeResults>;
          };
        }
      ).axe;
      const target = selector ? document.querySelector(selector) : document;
      if (!target) throw new Error(`axe context not found: ${selector}`);
      const results = await axe.run(target, {
        rules: { "color-contrast": { enabled: true } },
      });
      const format = (result: AxeResult) =>
        `${result.id}: ${result.nodes
          .map((node) => {
            const nodeSelector = node.target[0];
            const element =
              typeof nodeSelector === "string"
                ? document.querySelector(nodeSelector)
                : null;
            return `${node.target.join(" ")} :: aria-label="${element?.getAttribute("aria-label") ?? ""}" text="${element?.textContent?.trim() ?? ""}" html="${node.html ?? ""}"`;
          })
          .join(", ")}`;
      const relevantIncomplete = results.incomplete
        .filter((result) =>
          ["color-contrast", "label-content-name-mismatch"].includes(result.id),
        )
        .map((result) => ({
          ...result,
          nodes: result.nodes.filter((node) => {
            const nodeSelector = node.target[0];
            const element =
              typeof nodeSelector === "string"
                ? document.querySelector(nodeSelector)
                : null;
            // Two decorative surfaces are not resolvable by axe:
            // - the glass header composites `bg-card/80` over the board
            //   background, so the paint colour is unknown to axe; its text
            //   uses the foreground/muted tokens checked against every
            //   surface by theme-contrast.test.ts;
            // - avatar initials are a name-bearing `role="img"` tile, not
            //   content text (the full user label is the accessible name).
            // Only punctuation (e.g. the table's "—" empty marker) has no
            // label to compare, so axe's incomplete is not actionable there.
            const visible = element?.textContent?.trim() ?? "";
            const hasWords = /[\p{L}\p{N}]/u.test(visible);
            return !(
              element?.closest("header") ||
              element?.closest('[data-testid="user-avatar"]') ||
              !hasWords
            );
          }),
        }))
        .filter((result) => result.nodes.length > 0);
      return [
        ...results.violations.map(format),
        ...relevantIncomplete.map((result) => `incomplete ${format(result)}`),
      ];
    },
    { selector: context },
  );
}

async function expectNoAxeIssues(page: Page, context?: string) {
  expect(await axeIssues(page, context)).toEqual([]);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("janosik-theme", value);
  }, theme);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
}

async function seedBoard(board: BoardFixture) {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "A11y card");
  const labelId = await board.label("Yellow", "yellow");
  await board.command({ type: "SET_CARD_LABEL", cardId, labelId, on: true });
  await board.command({
    type: "UPDATE_CARD",
    cardId,
    description: "A unique accessibility description.",
  });
  await board.command({ type: "SET_CARD_PRIORITY", cardId, priority: "high" });

  const checklistId = randomUUID();
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: "Launch checklist",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: randomUUID(),
    text: "Write the docs",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: randomUUID(),
    text: "Ship the release",
  });

  // Completed checklist state: the card-front badge switches to the success
  // tint when every item is done.
  const completed = await board.card(todo, "Completed card");
  const completedChecklist = randomUUID();
  await board.command({
    type: "ADD_CHECKLIST",
    cardId: completed,
    newChecklistId: completedChecklist,
    title: "Completed checklist",
  });
  for (const text of ["First done item", "Second done item"]) {
    const itemId = randomUUID();
    await board.command({
      type: "ADD_CHECKLIST_ITEM",
      cardId: completed,
      checklistId: completedChecklist,
      newItemId: itemId,
      text,
    });
    await board.command({
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: completed,
      checklistId: completedChecklist,
      itemId,
      done: true,
    });
  }

  // Due-date states: overdue, soon (<24 h) and later each have a text badge.
  const now = Date.now();
  const dueCards: Array<[string, number]> = [
    ["Overdue card", now - 3_600_000],
    ["Due soon card", now + 2 * 3_600_000],
    ["Due later card", now + 7 * 86_400_000],
  ];
  for (const [title, dueDate] of dueCards) {
    const dueCard = await board.card(todo, title);
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId: dueCard,
      dueDate,
    });
  }

  // WIP state: a column above its limit paints the warning/danger badge.
  const doing = await board.column("Doing");
  await board.card(doing, "WIP one");
  await board.card(doing, "WIP two");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: doing,
    wipLimit: 1,
  });

  return { todo, cardId };
}

/** Every projection plus the filter popover; each must be axe-clean. */
async function expectViewsClean(page: Page) {
  await page.getByRole("button", { name: "Board", exact: true }).click();

  await page.getByRole("button", { name: /^Filters(?: \d+)?$/ }).click();
  await page.getByRole("radio", { name: "All", exact: true }).click();
  await expect(page.getByRole("radio", { name: "All" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNoAxeIssues(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByTestId("calendar-grid")).toBeVisible();
  await expectNoAxeIssues(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expectNoAxeIssues(page);

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByTestId("table-scroll")).toBeVisible();
  await expectNoAxeIssues(page);

  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByTestId("watch-view")).toBeVisible();
  await expectNoAxeIssues(page);
}

test.describe("card a11y", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("board page has no axe violations in light and dark", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");
    await expect(page.getByTestId("board-title")).toBeVisible();

    // One page heading, one main landmark and no li outside a list.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    const strayListItems = await page.evaluate(
      () =>
        [...document.querySelectorAll("li")].filter(
          (item) => !item.parentElement?.matches("ul, ol"),
        ).length,
    );
    expect(strayListItems).toBe(0);

    await expectNoAxeIssues(page);
    await setTheme(page, "dark");
    await expect(page.getByTestId("board-title")).toBeVisible();
    await expectNoAxeIssues(page);
  });

  test("card dialog has no axe violations in light and dark", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");
    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expectNoAxeIssues(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await setTheme(page, "dark");
    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoAxeIssues(page, '[role="dialog"]');
  });

  test("description match, calendar, table and watch are axe-clean", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");

    // A description-only match paints the highlighted description badge
    // (`CardItem` line 533) in addition to the active-filter chip.
    await page
      .getByRole("textbox", { name: "Search cards" })
      .fill("unique accessibility description");
    await expect(page.getByTestId("card-description-badge")).toHaveAttribute(
      "data-highlight",
      "description",
    );
    await expectNoAxeIssues(page);
    await page.getByRole("textbox", { name: "Search cards" }).fill("");

    await expectViewsClean(page);
    await setTheme(page, "dark");
    await expectViewsClean(page);
  });

  test("board settings keeps one main and no axe violations", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");

    await page.getByRole("button", { name: "Board settings" }).click();
    const settings = page.getByRole("dialog", { name: board.title });
    await expect(settings).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expectNoAxeIssues(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
  });

  test("checklist toggle and progressbar are named", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");
    await page.getByText("A11y card").click();

    const release = page.getByRole("button", {
      name: "Toggle Ship the release",
    });
    await expect(release).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: "Toggle Write the docs" }),
    ).toHaveAttribute("aria-pressed", "false");
    await release.click();
    await expect(release).toHaveAttribute("aria-pressed", "true");

    const progress = page.getByRole("progressbar", {
      name: "Launch checklist progress",
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(progress).toHaveAttribute("aria-valuemax", "2");
    await expect(progress).toHaveAttribute("aria-valuetext", "1 of 2 done");
  });

  test("keyboard open then Escape returns focus to the card", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");

    const card = page.getByRole("group", { name: "A11y card" });
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card).toBeFocused();
  });
});

test.describe("card a11y at 1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("board and dialog keep one main and no axe violations", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");
    await expect(page.locator("main")).toHaveCount(1);
    await expectNoAxeIssues(page);

    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expectNoAxeIssues(page, '[role="dialog"]');
  });
});

test.describe("card a11y at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("board and dialog keep one main and no axe violations", async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await board.open(page);
    await setTheme(page, "light");
    await expect(page.locator("main")).toHaveCount(1);
    await expectNoAxeIssues(page);

    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expectNoAxeIssues(page, '[role="dialog"]');
  });
});
