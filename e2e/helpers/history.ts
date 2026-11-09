import { expect, type Locator, type Page } from "@playwright/test";

/** The header undo/redo controls and their keyboard equivalents. */
export function undoButton(page: Page): Locator {
  return page.getByRole("button", { name: "Undo", exact: true });
}

export function redoButton(page: Page): Locator {
  return page.getByRole("button", { name: "Redo", exact: true });
}

export async function undo(page: Page): Promise<void> {
  await undoButton(page).click();
}

export async function redo(page: Page): Promise<void> {
  await redoButton(page).click();
}

export async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press("Control+z");
}

export async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press("Control+Shift+z");
}

export async function pressRedoY(page: Page): Promise<void> {
  await page.keyboard.press("Control+y");
}

export async function expectHistory(
  page: Page,
  state: { undo: boolean; redo: boolean },
): Promise<void> {
  if (state.undo) await expect(undoButton(page)).toBeEnabled();
  else await expect(undoButton(page)).toBeDisabled();
  if (state.redo) await expect(redoButton(page)).toBeEnabled();
  else await expect(redoButton(page)).toBeDisabled();
}

export function notifications(page: Page): Locator {
  return page.getByRole("region", { name: "Notifications" });
}

export function notification(page: Page, text: string): Locator {
  // Toasts live outside the dialog portal: while a modal is open Radix marks
  // the app root aria-hidden, so a role-based locator would miss a toast that
  // is visibly on screen. The class is the stable hook.
  return page.locator(".janosik-toast").filter({ hasText: text });
}

/** Column section whose header group carries the column title. */
export function columnSection(page: Page, name: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("group", { name, exact: true }) });
}

export function cardTitle(page: Page, title: string | RegExp): Locator {
  return page.getByTestId("card-title").filter({ hasText: title });
}

export function cardDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Card details" });
}

export function cardTitleInput(page: Page): Locator {
  return cardDialog(page).getByRole("textbox", { name: "Title" });
}

/** The MDX description surface (contenteditable, not a textbox). */
export function descriptionEditor(page: Page): Locator {
  return cardDialog(page).locator(".janosik-md-content").first();
}

export async function expectDescription(
  page: Page,
  text: string | RegExp,
): Promise<void> {
  await expect(descriptionEditor(page)).toBeVisible();
  await expect(descriptionEditor(page)).toHaveText(text);
}

/** Right-click a card on the board and wait for its context menu. */
export async function openCardContextMenu(
  page: Page,
  title: string,
): Promise<Locator> {
  await cardTitle(page, title).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openCard(
  page: Page,
  title: string | RegExp,
): Promise<void> {
  await cardTitle(page, title).click();
  await expect(cardDialog(page)).toBeVisible();
}

export async function closeCardDialog(page: Page): Promise<void> {
  const dialog = cardDialog(page);
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(dialog).toBeHidden();
}

/** Open a column's overflow menu and pick one entry. */
export async function columnMenu(
  page: Page,
  column: string,
  action: string,
): Promise<void> {
  await columnSection(page, column)
    .getByRole("button", { name: "Column options" })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Card order inside a column, as rendered. */
export async function cardOrder(page: Page, column: string): Promise<string[]> {
  return columnSection(page, column)
    .getByTestId("card-title")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim() ?? ""),
    );
}
