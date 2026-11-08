import { expect, type Locator, type Page } from "@playwright/test";

export function filterBar(page: Page): Locator {
  return page.getByTestId("filter-bar");
}

export function filtersPopover(page: Page): Locator {
  return page.getByTestId("filters-popover");
}

export function searchInput(page: Page): Locator {
  return filterBar(page).getByRole("textbox", { name: "Search cards" });
}

/** Result count span ("1 card found") — absent while no filter is active. */
export function matchCount(page: Page): Locator {
  return filterBar(page).getByTestId("filter-match-count");
}

/** Number badge on the Filters button, exactly the active-facet count. */
export function facetCount(page: Page): Locator {
  return filterBar(page).getByTestId("filter-facet-count");
}

/** Removable chip for one facet (priority/assignee may have several). */
export function facetChip(page: Page, facet: string): Locator {
  return filterBar(page).locator(
    `[data-testid="filter-chip"][data-facet="${facet}"]`,
  );
}

export async function removeChip(page: Page, facet: string): Promise<void> {
  await facetChip(page, facet)
    .getByRole("button", { name: "Remove label" })
    .click();
}

export async function resetFilters(page: Page): Promise<void> {
  await filterBar(page).getByTestId("filter-reset").click();
}

/** The card face (article) whose title is exactly `title`. */
export function cardByTitle(page: Page, title: string): Locator {
  const exact = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator("article").filter({
    has: page.getByTestId("card-title").filter({ hasText: exact }),
  });
}

export async function openFilters(page: Page): Promise<Locator> {
  await filterBar(page).getByRole("button", { name: "Filter cards" }).click();
  await expect(filtersPopover(page)).toBeVisible();
  return filtersPopover(page);
}

export async function closeFilters(page: Page): Promise<void> {
  if (!(await filtersPopover(page).isVisible())) return;
  await page.keyboard.press("Escape");
  await expect(filtersPopover(page)).toBeHidden();
}

/** Open the facet popover, pick one option, and close it again. */
export async function pickFacet(
  page: Page,
  role: "radio" | "checkbox",
  name: string,
): Promise<void> {
  const popover = await openFilters(page);
  await popover.getByRole(role, { name, exact: true }).click();
  await closeFilters(page);
}

export async function search(page: Page, query: string): Promise<void> {
  await searchInput(page).fill(query);
}

export async function clearSearchWithButton(page: Page): Promise<void> {
  await filterBar(page)
    .getByRole("button", { name: "Reset filters" })
    .first()
    .click();
}

/** Visible card titles in board order (columns left to right). */
export async function expectCardTitles(
  page: Page,
  titles: string[],
): Promise<void> {
  await expect
    .poll(() => page.getByTestId("card-title").allTextContents())
    .toEqual(titles);
}
