import { expect, type Locator, type Page } from "@playwright/test";

import { columnSection, cardTitle } from "./history.js";

/**
 * Browser helpers for the admin-configurable workflow suite. They use the
 * same DOM contracts as the existing board/history helpers: a column section
 * is found by its header group, a card by `data-testid="card-title"`, and the
 * editor by its stable test ids.
 */

/** Drag a card from one column to another through the real pointer stream. */
export async function dragCard(
  page: Page,
  fromColumn: string,
  title: string,
  toColumn: string,
): Promise<void> {
  const source = await cardTitle(page, title).boundingBox();
  const target = await columnSection(page, toColumn)
    .getByTestId("column-card-scroll")
    .boundingBox();
  if (!source || !target) {
    throw new Error(`Card "${title}" or column "${toColumn}" is not visible`);
  }
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 10,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(target.x + target.width / 2, target.y + 50, {
    steps: 20,
  });
  await page.mouse.up();
}

/**
 * Move the pointer over a column without releasing the card. Lets a test
 * assert the disabled-target UI before the drop.
 */
export async function hoverCardOverColumn(
  page: Page,
  title: string,
  toColumn: string,
): Promise<void> {
  const source = await cardTitle(page, title).boundingBox();
  const target = await columnSection(page, toColumn)
    .getByTestId("column-card-scroll")
    .boundingBox();
  if (!source || !target) {
    throw new Error(`Card "${title}" or column "${toColumn}" is not visible`);
  }
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 10,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(target.x + target.width / 2, target.y + 50, {
    steps: 20,
  });
}

/** Open «Board settings» and return the dialog. */
export async function openBoardSettings(page: Page): Promise<Locator> {
  await page.getByTestId("board-settings-trigger").click();
  const dialog = page.getByTestId("board-settings-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Toggle one matrix cell until it is allowed, then return its button. */
export async function allowTransition(
  page: Page,
  fromColumnId: string,
  toColumnId: string,
): Promise<Locator> {
  const cell = page.getByTestId(`workflow-cell-${fromColumnId}-${toColumnId}`);
  if ((await cell.getAttribute("aria-pressed")) !== "true") {
    await cell.click();
  }
  return cell;
}

/** Save the workflow editor and wait for the dialog to close. */
export async function saveWorkflow(page: Page): Promise<void> {
  await page.getByTestId("workflow-save").click();
  await expect(page.getByTestId("board-settings-dialog")).toBeHidden();
}

/** Right-click a card and open its "Move to" submenu. */
export async function openMoveMenu(
  page: Page,
  title: string,
): Promise<Locator> {
  await cardTitle(page, title).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.getByTestId("ctx-move-trigger").click();
  const content = page.getByTestId("ctx-move-content");
  await expect(content).toBeVisible();
  return content;
}
