/**
 * localStorage helpers with strict error handling.
 *
 * localStorage can throw (quota exceeded, private mode, storage disabled)
 * and saved data can be corrupt (hand-edited, older version, wrong shape).
 * Every helper degrades gracefully instead of crashing the app.
 *
 * Corrupt data is never dropped on the floor: `readJSON` distinguishes
 * "no key" from "key does not parse" and quarantines the unparsable text
 * under `<key>.corrupt.<timestamp>` before the app writes anything over it.
 */

/** Outcome of a strict read — the four states a stored value can be in. */
export type LoadResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  /**
   * The key exists but does not parse. `quarantineKey` is where the raw
   * text was copied, or `null` when even that copy failed (quota) — the
   * caller must then keep the original key untouched.
   */
  | { status: "corrupt"; quarantineKey: string | null }
  /** Storage itself is unreachable (private mode, disabled by policy). */
  | { status: "unavailable" };

const CORRUPT_SUFFIX = ".corrupt.";
/** How many quarantined copies of one key are kept before rotation. */
const MAX_QUARANTINE_COPIES = 3;

/** Read a raw (unparsed) value; null when missing or storage is unreachable. */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Every quarantined copy of `key`, newest first. */
export function listQuarantineKeys(key: string): string[] {
  const prefix = `${key}${CORRUPT_SUFFIX}`;
  try {
    return Object.keys(localStorage)
      .filter((candidate) => candidate.startsWith(prefix))
      .sort(
        (a, b) =>
          quarantineTimestamp(b, prefix) - quarantineTimestamp(a, prefix),
      );
  } catch {
    return [];
  }
}

function quarantineTimestamp(key: string, prefix: string): number {
  const parsed = Number(key.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Copy unparsable text aside so the app can start fresh without destroying
 * it. Rotates first (a repeated failure must not eat the whole quota) and
 * returns the quarantine key, or null when the copy could not be written.
 */
export function quarantineValue(key: string, raw: string): string | null {
  // Free the slot before writing: with a nearly full quota the copy only
  // fits once the oldest ones are gone.
  for (const stale of listQuarantineKeys(key).slice(
    MAX_QUARANTINE_COPIES - 1,
  )) {
    try {
      localStorage.removeItem(stale);
    } catch {
      /* storage unreachable — the write below fails too, reported as null */
    }
  }
  const target = `${key}${CORRUPT_SUFFIX}${Date.now()}`;
  try {
    localStorage.setItem(target, raw);
    return target;
  } catch {
    return null;
  }
}

/**
 * Read and JSON.parse a value, reporting *why* it is unusable. Unparsable
 * text is quarantined as a side effect — the raw bytes survive whatever the
 * caller writes next.
 */
export function readJSON<T>(key: string): LoadResult<T> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "missing" };
  try {
    return { status: "ok", value: JSON.parse(raw) as T };
  } catch {
    return { status: "corrupt", quarantineKey: quarantineValue(key, raw) };
  }
}

/**
 * One-time key rename (e.g. the app rebrand Vortex → Janosik). If the new
 * key is missing but the old one holds data, copy it over and drop the old
 * key so no user data is lost. No-op in every other case.
 */
export function migrateStorageKey(oldKey: string, newKey: string): void {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const raw = localStorage.getItem(oldKey);
    if (raw === null) return;
    localStorage.setItem(newKey, raw);
    localStorage.removeItem(oldKey);
  } catch {
    /* storage unavailable — leave keys untouched */
  }
}

/** Stringify and store a value; returns false when storage failed. */
export function saveJSON<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
