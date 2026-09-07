import { loadJSON, saveJSON } from "@/utils/storage";

/**
 * Debounced persistence for the board state.
 *
 * `queueSave` coalesces rapid changes (typing, drag) into a single write
 * after `delayMs` of quiet; `flush` writes any pending state immediately,
 * which the provider calls on `beforeunload`/`pagehide` so closing the tab
 * never loses the last change. Storage failures surface through an error
 * handler instead of failing silently.
 */

export interface DebouncedPersistence<T> {
  /** Synchronously read the stored value (used at bootstrap). */
  load(): T | null;
  /** Debounced write — safe to call on every state change. */
  queueSave(value: T): void;
  /** Immediately write any pending value (beforeunload / unmount). */
  flush(): void;
  /** Install/clear the handler invoked when a write fails. */
  setErrorHandler(handler: ((error: unknown) => void) | null): void;
}

export function createDebouncedLocalStoragePersistence<T>(
  key: string,
  delayMs = 400,
): DebouncedPersistence<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let errorHandler: ((error: unknown) => void) | null = null;

  function write(value: T): void {
    const ok = saveJSON(key, value);
    if (!ok) errorHandler?.(new Error(`saveJSON failed for ${key}`));
  }

  return {
    load() {
      return loadJSON<T>(key);
    },
    queueSave(value) {
      pending = { value };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending === null) return;
        const toWrite = pending;
        pending = null;
        write(toWrite.value);
      }, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending === null) return;
      const toWrite = pending;
      pending = null;
      write(toWrite.value);
    },
    setErrorHandler(handler) {
      errorHandler = handler;
    },
  };
}