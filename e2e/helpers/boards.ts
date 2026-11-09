import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

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

/** The subset of the board aggregate the view tests assert against. */
export interface BoardSnapshot {
  id: string;
  columns: { id: string; title: string; cardIds: string[] }[];
  cards: Record<
    string,
    {
      id: string;
      title: string;
      dueDate?: number;
      labelIds: string[];
      assigneeId?: string;
      priority?: string;
      archivedAt?: number;
    }
  >;
}

/** Read the current board aggregate through the API (setup/assertion only). */
export async function getBoard(
  api: APIRequestContext,
  boardId: string,
): Promise<BoardSnapshot> {
  const response = await api.get(`/api/v1/boards/${boardId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as BoardSnapshot;
}
