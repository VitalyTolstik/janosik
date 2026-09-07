import type { Board, Column } from "@/types/kanban";
import type { BoardState } from "@/store/board-reducer";
import { normalizeBoards } from "@/store/migrate";

/**
 * Export / import of the whole board state as a JSON document.
 *
 * The file format doubles as the future server seed format: a stable
 * envelope (`app`, `schemaVersion`, `exportedAt`) around the raw `boards`
 * array. Import validates the envelope and normalizes legacy shapes
 * (`normalizeBoards`) before the state is handed to the store.
 */

export const EXPORT_APP = "janosik";
export const EXPORT_SCHEMA_VERSION = 1;

export interface BoardExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: number;
  exportedAt: number;
  boards: BoardState;
}

export function serializeExport(boards: BoardState): string {
  const payload: BoardExportFile = {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    boards,
  };
  return JSON.stringify(payload, null, 2);
}

/** Parse and validate an export file; throws a readable Error when invalid. */
export function parseExport(raw: string): BoardState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("MISSING-item");
  }
  const file = parsed as Partial<BoardExportFile>;

  if (file.app !== EXPORT_APP) {
    throw new Error("Not a Janosik export");
  }
  if (
    typeof file.schemaVersion !== "number" ||
    file.schemaVersion > EXPORT_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported schema version");
  }
  if (!isBoardState(file.boards)) {
    throw new Error("Missing valid board data");
  }
  return normalizeBoards(file.boards);
}

function isBoardState(value: unknown): value is BoardState {
  return Array.isArray(value) && value.every(isBoard);
}

function isBoard(value: unknown): value is Board {
  if (typeof value !== "object" || value === null) return false;
  const board = value as Partial<Board>;
  return (
    typeof board.id === "string" &&
    typeof board.title === "string" &&
    Array.isArray(board.columns) &&
    board.columns.every(isColumn) &&
    typeof board.cards === "object" &&
    board.cards !== null &&
    !Array.isArray(board.cards) &&
    Array.isArray(board.labels)
  );
}

function isColumn(value: unknown): value is Column {
  if (typeof value !== "object" || value === null) return false;
  const column = value as Partial<Column>;
  return (
    typeof column.id === "string" &&
    Array.isArray(column.cardIds) &&
    column.cardIds.every((id) => typeof id === "string")
  );
}
