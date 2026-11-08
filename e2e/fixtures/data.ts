import { randomUUID } from "node:crypto";
import { test as boardTest, expect } from "./board.js";
import { createExtraBoard } from "../helpers/boards.js";
import type {
  BoardEnvelope,
  BoardSummary,
  ImportFile,
} from "../helpers/data.js";

export interface ImportableBoardOptions {
  /** Title the board should carry after import; unique by default. */
  title?: string;
  /** Column titles created on the source board, in order. */
  columns?: string[];
  /** Cards created on the source board; `column` must be a title above. */
  cards?: Array<{ column: string; title: string }>;
  /** Labels created on the source board. */
  labels?: string[];
}

export interface ImportableBoard {
  /** Unique title written into the envelope. */
  title: string;
  envelope: BoardEnvelope;
  file: ImportFile;
}

export interface DataWorkspace {
  listBoards: () => Promise<BoardSummary[]>;
  exportBoard: (boardId: string) => Promise<BoardEnvelope>;
  /** A file carrying `boards` inside a fresh envelope. */
  importFile: (boards: BoardEnvelope["boards"], name?: string) => ImportFile;
  /** A file carrying an existing envelope unchanged. */
  fileFromEnvelope: (envelope: BoardEnvelope, name?: string) => ImportFile;
  /**
   * Build a ready-to-import board with content through the API: create a
   * source board, fill it, export it, delete the source and rename the board
   * in the envelope to a unique title. The test only drives the UI import.
   */
  importableBoard: (
    options?: ImportableBoardOptions,
  ) => Promise<ImportableBoard>;
}

function envelope(boards: BoardEnvelope["boards"]): BoardEnvelope {
  return {
    app: "janosik",
    schemaVersion: 1,
    exportedAt: Date.now(),
    boards,
  };
}

function jsonFile(payload: unknown, name: string): ImportFile {
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload, null, 2)),
  };
}

/**
 * Server-mode data workspace used by `tests/app/data/`: one account and one
 * board per test from the board fixture, plus API-side helpers that prepare
 * envelopes without driving the UI for setup.
 */
export const test = boardTest.extend<{ data: DataWorkspace }>({
  data: async ({ board }, use) => {
    const api = board.api;

    const listBoards = async (): Promise<BoardSummary[]> => {
      const response = await api.get("/api/v1/boards");
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as BoardSummary[];
    };

    const exportBoard = async (boardId: string): Promise<BoardEnvelope> => {
      const response = await api.get(`/api/v1/boards/${boardId}/export`);
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as BoardEnvelope;
    };

    const fileFromEnvelope = (
      value: BoardEnvelope,
      name = "janosik-import.json",
    ): ImportFile => jsonFile(value, name);

    const importFile = (
      boards: BoardEnvelope["boards"],
      name = "janosik-import.json",
    ): ImportFile => jsonFile(envelope(boards), name);

    const importableBoard = async (
      options: ImportableBoardOptions = {},
    ): Promise<ImportableBoard> => {
      const source = await createExtraBoard(api, `Source ${randomUUID()}`);
      const columns = new Map<string, string>();
      for (const title of options.columns ?? []) {
        columns.set(title, await source.column(title));
      }
      for (const card of options.cards ?? []) {
        const columnId = columns.get(card.column);
        if (columnId === undefined) {
          throw new Error(
            `Card "${card.title}" references unknown column "${card.column}"`,
          );
        }
        await source.card(columnId, card.title);
      }
      for (const name of options.labels ?? []) {
        await source.label(name);
      }

      const exported = await exportBoard(source.id);
      expect(exported.boards).toHaveLength(1);
      const removed = await api.delete(`/api/v1/boards/${source.id}`);
      expect(removed.ok()).toBeTruthy();

      const title =
        options.title ?? `Imported board ${randomUUID().slice(0, 8)}`;
      exported.boards[0].title = title;
      return {
        title,
        envelope: exported,
        file: fileFromEnvelope(exported, `${title}.json`),
      };
    };

    await use({
      listBoards,
      exportBoard,
      importFile,
      fileFromEnvelope,
      importableBoard,
    });
  },
});

export { expect };
