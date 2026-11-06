import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

export interface SearchBoard {
  id: string;
  title: string;
  command: (action: Record<string, unknown>) => Promise<void>;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  label: (name: string, color?: string) => Promise<string>;
}

export async function createSearchBoard(
  api: APIRequestContext,
  title: string,
): Promise<SearchBoard> {
  const created = await api.post("/api/v1/boards", { data: { title } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const command = async (action: Record<string, unknown>) => {
    const response = await api.post(`/api/v1/boards/${id}/commands`, {
      data: {
        commandId: randomUUID(),
        action: { boardId: id, at: Date.now(), ...action },
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  const column = async (columnTitle: string) => {
    const newColumnId = randomUUID();
    await command({ type: "ADD_COLUMN", newColumnId, title: columnTitle });
    return newColumnId;
  };
  const card = async (columnId: string, cardTitle: string) => {
    const newCardId = randomUUID();
    await command({ type: "ADD_CARD", newCardId, columnId, title: cardTitle });
    return newCardId;
  };
  const label = async (name: string, color = "red") => {
    const labelId = randomUUID();
    await command({ type: "ADD_LABEL", label: { id: labelId, name, color } });
    return labelId;
  };
  return { id, title, command, column, card, label };
}

export async function archiveCard(
  board: Pick<SearchBoard, "command">,
  cardId: string,
) {
  await board.command({ type: "ARCHIVE_CARD", cardId });
}

export async function archiveBoard(board: Pick<SearchBoard, "command">) {
  await board.command({ type: "ARCHIVE_BOARD" });
}

export async function addChecklistItem(
  command: (action: Record<string, unknown>) => Promise<void>,
  cardId: string,
  text: string,
  title = "DoD",
) {
  const checklistId = randomUUID();
  await command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title,
  });
  await command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: randomUUID(),
    text,
  });
}

export function globalSearchButton(page: Page): Locator {
  return page.getByRole("button", { name: "Search cards and boards" });
}

export function globalSearchInput(page: Page): Locator {
  return page.getByTestId("global-search-input");
}

export function globalSearchResults(page: Page): Locator {
  return page.getByTestId("global-search-results");
}

export function globalSearchSection(
  page: Page,
  name: "Cards" | "Boards",
): Locator {
  return globalSearchResults(page).getByRole("listbox", {
    name,
    exact: true,
  });
}

export function globalSearchOption(page: Page, text: string): Locator {
  return globalSearchResults(page)
    .getByRole("option")
    .filter({ hasText: text });
}

export async function openGlobalSearch(page: Page): Promise<Locator> {
  await globalSearchButton(page).click();
  const input = globalSearchInput(page);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

export async function searchGlobally(page: Page, query: string) {
  await globalSearchInput(page).fill(query);
}

export function archiveSearchInput(page: Page): Locator {
  return page.getByTestId("archive-search");
}

export async function openArchive(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  const dialog = page.getByRole("dialog", { name: "Card archive" });
  await expect(dialog).toBeVisible();
  return dialog;
}
