import type { Board } from "../types/kanban";
import type { BoardState } from "../store/board-reducer";
import { normalizeBoards } from "../store/migrate";
import { validateImportedBoards } from "../store/validate";

/**
 * Export / import of the whole board state as a JSON document.
 *
 * The file format doubles as the future server seed format: a stable
 * envelope (`app`, `schemaVersion`, `exportedAt`) around the raw `boards`
 * array. Import validates the envelope and normalizes legacy shapes
 * (`normalizeBoards`) before the state is handed to the store.
 */

export const EXPORT_APP = "janosik";
/** Version 4 adds board epics and card membership. */
export const EXPORT_SCHEMA_VERSION = 4;

export interface BoardExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: number;
  exportedAt: number;
  boards: BoardState;
}

export interface ParseExportOptions {
  /**
   * Maximum number of boards in the file. Defaults to the local/offline
   * `LIMITS.boardsCount` guard; `null` disables the envelope check (the
   * server then enforces its own operator cap atomically).
   */
  maxBoards?: number | null;
}

export function serializeExport(boards: BoardState): string {
  const payload: BoardExportFile = {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    boards: boards.map(withoutDanglingMembership),
  };
  return JSON.stringify(payload, null, 2);
}

/** Parse and validate an export file; throws a readable Error when invalid. */
export function parseExport(
  raw: string,
  options: ParseExportOptions = {},
): BoardState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Not valid JSON");
  }
  return parseExportValue(parsed, options);
}

/**
 * Validate an already-parsed export value. Kept separate so the server can
 * hand over the Express-parsed body without a `JSON.stringify` → `JSON.parse`
 * round trip (TASK-166.6).
 */
export function parseExportValue(
  parsed: unknown,
  options: ParseExportOptions = {},
): BoardState {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Malformed export file");
  }
  const file = parsed as Partial<BoardExportFile>;

  if (file.app !== EXPORT_APP) {
    throw new Error("Not a Janosik export");
  }
  const version = file.schemaVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > EXPORT_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported schema version");
  }
  if (!Array.isArray(file.boards)) {
    throw new Error("Missing valid board data");
  }
  // Strict structure and integrity first (types, LIMITS, ids, references),
  // then the lenient pass for what it can repair (clamps, legacy shapes) —
  // a malformed file fails here with a field path, not with a TypeError
  // inside normalization or a 500 from the server's writer.
  const includeEpics = version >= 4;
  const checked = validateImportedBoards(file.boards, {
    ...options,
    includeEpics,
  });
  if (!checked.ok) {
    throw new Error(
      `Invalid board data at ${checked.field}: ${checked.message}`,
    );
  }
  const boards = includeEpics
    ? checked.boards
    : checked.boards.map(({ epics: _epics, ...board }) =>
        withoutDanglingMembership(board),
      );
  return normalizeBoards(boards).map(withoutDanglingMembership);
}

/** A backup contains only live epics, so it cannot restore dangling memberships. */
function withoutDanglingMembership(board: Board): Board {
  const ids = new Set(board.epics?.map(({ id }) => id));
  let cards = board.cards;
  for (const [id, card] of Object.entries(board.cards)) {
    if (
      !Object.hasOwn(card, "epicId") ||
      (card.epicId !== undefined && ids.has(card.epicId))
    )
      continue;
    if (cards === board.cards) cards = { ...cards };
    const copy = { ...card };
    delete copy.epicId;
    cards[id] = copy;
  }
  return cards === board.cards ? board : { ...board, cards };
}
