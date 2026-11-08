import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** A second board on the same account, with API setup wrappers. */
export interface ExtraBoard {
  id: string;
  title: string;
  command: (action: Record<string, unknown>) => Promise<void>;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  label: (name: string, color?: string) => Promise<string>;
}

export async function createExtraBoard(
  api: APIRequestContext,
  title: string,
): Promise<ExtraBoard> {
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

/** The column section whose header group carries `name`. */
export function boardColumn(page: Page, name: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("group", { name, exact: true }) });
}

/**
 * Drag a card onto a column body with the same pointer sequence a user
 * performs. dnd-kit needs a small move after pointerdown to start the drag,
 * then a slow path over the target so `dragOver` commits the hover slot.
 */
export async function dragCardToColumn(
  page: Page,
  cardTitle: string,
  columnName: string,
): Promise<void> {
  const source = page
    .getByTestId("card-title")
    .filter({ hasText: cardTitle })
    .first();
  const target = boardColumn(page, columnName).getByTestId(
    "column-card-scroll",
  );
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`Card "${cardTitle}" or column "${columnName}" is hidden`);
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 + 10,
    sourceBox.y + sourceBox.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + Math.min(48, targetBox.height / 2),
    { steps: 25 },
  );
  await page.mouse.up();
}
