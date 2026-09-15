import { readJSON, saveJSON, type LoadResult } from "@/utils/storage";

/**
 * Debounced persistence for the board state.
 *
 * `queueSave` coalesces rapid changes (typing, drag) into a single write
 * after `delayMs` of quiet; `flush` writes any pending state immediately,
 * which the provider calls on `beforeunload`/`pagehide` so closing the tab
 * never loses the last change. Every write attempt is reported to the write
 * listener, so a failing storage (quota, private mode) surfaces in the UI
 * instead of failing silently. The report carries the serialized size, so a
 * nearly-full storage can be flagged *before* a write actually fails.
 *
 * Writes can also be held back entirely (`setWritesEnabled(false)`): after a
 * corrupt read that could not be quarantined, the unparsable text in storage
 * is the user's only copy and must not be overwritten by fresh state until
 * they have been told about it.
 */

export interface DebouncedPersistence<T> {
  /** Read the stored value, reporting missing / corrupt / unavailable. */
  load(): LoadResult<T>;
  /** Debounced write — safe to call on every state change. */
  queueSave(value: T): void;
  /** Immediately write any pending value (beforeunload / unmount). */
  flush(): void;
  /**
   * Allow or hold back writes. Re-enabling writes any value queued while
   * held; disabling keeps the pending value for later.
   */
  setWritesEnabled(enabled: boolean): void;
  /** Install/clear the listener invoked after every write attempt. */
  setWriteListener(
    listener: ((ok: boolean, error?: unknown, bytes?: number) => void) | null,
  ): void;
}

/** Five megabytes is the common localStorage budget browsers grant. */
const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;
/** A write attempt this large deserves a warning before the quota refuses. */
export const QUOTA_WARNING_BYTES = Math.round(ASSUMED_QUOTA_BYTES * 0.8);

export function createDebouncedLocalStoragePersistence<T>(
  key: string,
  delayMs = 400,
): DebouncedPersistence<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let writesEnabled = true;
  let writeListener:
    ((ok: boolean, error?: unknown, bytes?: number) => void) | null = null;

  function write(value: T): void {
    // Serialized once here for the size report; saveJSON stringifies again —
    // this runs on debounced writes only, not per keystroke. The size is the
    // UTF-8 byte length, not the UTF-16 string length: localStorage is
    // budgeted in bytes, so non-ASCII text (Cyrillic, emoji) costs more than
    // one unit per character.
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json).length;
    const ok = saveJSON(key, value);
    writeListener?.(
      ok,
      ok ? undefined : new Error(`saveJSON failed for ${key}`),
      bytes,
    );
  }

  /** Write the queued value, unless writes are held back. */
  function writePending(): void {
    if (pending === null || !writesEnabled) return;
    const toWrite = pending;
    pending = null;
    write(toWrite.value);
  }

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    load() {
      return readJSON<T>(key);
    },
    queueSave(value) {
      pending = { value };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        writePending();
      }, delayMs);
    },
    flush() {
      clearTimer();
      writePending();
    },
    setWritesEnabled(enabled) {
      writesEnabled = enabled;
      // Nothing was written while held back — catch up now.
      if (enabled) writePending();
    },
    setWriteListener(listener) {
      writeListener = listener;
    },
  };
}
