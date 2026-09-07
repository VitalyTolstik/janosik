/**
 * localStorage helpers with strict error handling.
 *
 * localStorage can throw (quota exceeded, private mode, storage disabled)
 * and saved data can be corrupt (hand-edited, older version, wrong shape).
 * Every helper degrades gracefully instead of crashing the app.
 */

/** Read and JSON.parse a value; returns null when missing or corrupt. */
export function loadJSON<T>(key: string): T | null {
   try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
   } catch {
      return null;
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
