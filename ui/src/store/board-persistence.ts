import {
  BOARD_STORAGE_KEY,
  initialBoardState,
  normalizeBoards,
  serializeExport,
  type BoardEnvelope,
  type BoardState,
} from "@janosik/shared";
import {
  migrateStorageKey,
  quarantineValue,
  readJSON,
  readRaw,
} from "@/utils/storage";
import type { DebouncedPersistence } from "@/utils/persistence";

/**
 * Local-mode persistence helpers for `BoardProvider` (extracted from the
 * god-module, TASK-118): boot/load, the one-time brand migration, the
 * pre-server data import envelope and the damaged-data quarantine.
 */

export const STORAGE_KEY = BOARD_STORAGE_KEY;

/**
 * A data problem the user has to know about.
 *
 * - `save-blocked` — the last write failed, so nothing is being persisted
 *   any more. Not dismissible: the banner stays until a write succeeds.
 * - `quota-warning` — a write succeeded, but the serialized data is past
 *   80% of the assumed localStorage quota. The next failed write is only a
 *   matter of time; dismissible, and it goes away on its own once the data
 *   shrinks back under the threshold (TASK-21.5).
 * - `corrupt-load` — the stored data did not parse. `sourceKey` is where
 *   the raw text can still be read from (the quarantine copy, or the
 *   original key when the copy failed and writes are held back).
 */
export type DataIssue =
  | { kind: "save-blocked" }
  | { kind: "quota-warning"; bytes: number }
  | { kind: "corrupt-load"; sourceKey: string; quarantined: boolean };

export interface BootState {
  state: BoardState;
  issue: DataIssue | null;
}

/**
 * The pre-server board data, if any (schema-validated). Read once on the
 * first server login: an account with zero boards inherits the local boards
 * through `POST /boards/import`, and the key is dropped afterwards so the
 * same data cannot be imported twice (TASK-29 migration, archived cards
 * included — the export envelope carries them).
 */
export function readLegacyBoards(): BoardState | null {
  const stored = readJSON<BoardState>(STORAGE_KEY);
  if (stored.status !== "ok" || !Array.isArray(stored.value)) return null;
  if (stored.value.length === 0) return null;
  return normalizeBoards(stored.value);
}

/** Drop the migrated local board data; failures are irrelevant (quota). */
export function clearLegacyBoards(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the key stays, import is skipped next time */
  }
}

/** Wrap a live board in the import envelope the API expects. */
export function toEnvelope(boards: BoardState): BoardEnvelope {
  return JSON.parse(serializeExport(boards)) as BoardEnvelope;
}

export function loadInitialState(
  persistence: DebouncedPersistence<BoardState>,
): BootState {
  // One-time brand migration (Vortex → Janosik) — read before the new key.
  migrateStorageKey("vortex-boards", STORAGE_KEY);
  const stored = persistence.load();
  if (stored.status === "ok" && Array.isArray(stored.value)) {
    // An empty array is a legitimate "no boards yet" — nothing to lose.
    return stored.value.length > 0
      ? { state: normalizeBoards(stored.value), issue: null }
      : { state: initialBoardState(), issue: null };
  }
  if (stored.status === "ok") {
    // Valid JSON of the wrong shape (not a board array) would be replaced
    // by the seed just as silently as unparsable text — quarantine it too.
    const raw = readRaw(STORAGE_KEY);
    return damagedData(
      persistence,
      raw === null ? null : quarantineValue(STORAGE_KEY, raw),
    );
  }
  if (stored.status === "corrupt") {
    return damagedData(persistence, stored.quarantineKey);
  }
  return { state: initialBoardState(), issue: null };
}

/**
 * Start from the seed board while keeping the damaged data reachable: it is
 * either copied aside under the quarantine key, or — when even that copy
 * failed (quota) — left in place, with writes held back so the seed cannot
 * erase it until the user has acknowledged the banner.
 */
function damagedData(
  persistence: DebouncedPersistence<BoardState>,
  quarantineKey: string | null,
): BootState {
  if (quarantineKey === null) persistence.setWritesEnabled(false);
  return {
    state: initialBoardState(),
    issue: {
      kind: "corrupt-load",
      sourceKey: quarantineKey ?? STORAGE_KEY,
      quarantined: quarantineKey !== null,
    },
  };
}
