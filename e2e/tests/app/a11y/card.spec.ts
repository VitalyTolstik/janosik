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
 * desktop widths, on the board and inside the card dialog.
 */

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

type AxeResults = {
  violations: Array<{
    id: string;
    nodes: Array<{ target: Array<string | string[]>; html?: string }>;
  }>;
};

async function axeViolations(page: Page, context?: string) {
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
      return results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => {
              const selector = node.target[0];
              const element =
                typeof selector === "string"
                  ? document.querySelector(selector)
                  : null;
              return `${node.target.join(" ")} :: aria-label="${element?.getAttribute("aria-label") ?? ""}" text="${element?.textContent?.trim() ?? ""}" html="${node.html ?? ""}"`;
            })
            .join(", ")}`,
      );
    },
    { selector: context },
  );
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
  return { todo, cardId };
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

    expect(await axeViolations(page)).toEqual([]);
    await setTheme(page, "dark");
    expect(await axeViolations(page)).toEqual([]);
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

    expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await setTheme(page, "dark");
    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
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
    expect(await axeViolations(page)).toEqual([]);

    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
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
    expect(await axeViolations(page)).toEqual([]);

    await page.getByText("A11y card").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
  });
});
