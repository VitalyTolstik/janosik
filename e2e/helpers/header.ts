import { expect, type Locator, type Page } from "@playwright/test";

/**
 * H1 header entry points. Members/Share now live under People; Board settings,
 * Data & backups, Card archive and Help live under the Board ⋯ menu. Tests
 * should use these helpers instead of the removed standalone triggers.
 */

export function peopleTrigger(page: Page): Locator {
  return page.getByTestId("people-trigger");
}

export function boardMenuTrigger(page: Page): Locator {
  return page.getByTestId("board-menu-trigger");
}

export async function openPeople(page: Page): Promise<Locator> {
  await peopleTrigger(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openMembers(page: Page): Promise<Locator> {
  await openPeople(page);
  await page.getByRole("menuitem", { name: "Members", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByTestId("board-members-box") });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openShare(page: Page): Promise<Locator> {
  await openPeople(page);
  await page.getByRole("menuitem", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share this board" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openBoardMenu(page: Page): Promise<Locator> {
  await boardMenuTrigger(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openBoardSettings(page: Page): Promise<Locator> {
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Board settings" }).click();
  const dialog = page.getByTestId("board-settings-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openCardArchive(page: Page): Promise<Locator> {
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: /Card archive/ }).click();
  const dialog = page.getByRole("dialog", { name: /Card archive/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openHelpMenu(page: Page): Promise<Locator> {
  await openBoardMenu(page);
  await page.getByTestId("board-menu-help").click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}
