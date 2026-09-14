import type { BoardState } from "@/store/board-reducer";
import { normalizeBoards } from "@/store/migrate";

/**
 * Automatic backups of the board state, stored in IndexedDB (much larger
 * quota than localStorage). Every saved snapshot is rotated — the newest
 * `MAX_BACKUPS` entries are kept.
 *
 * IndexedDB is a browser-only API: callers guard with `.catch()` (the
 * provider swallows failures; tests use `fake-indexeddb`).
 *
 * Transaction discipline: the completion promise must be created *before*
 * any request is issued — attaching `oncomplete` after awaiting a request
 * races with the transaction's auto-commit and can hang forever.
 */

const DB_NAME = "janosik-backups";
const STORE_NAME = "snapshots";
export const MAX_BACKUPS = 20;

interface BackupRecord {
  id: number;
  createdAt: number;
  boardCount: number;
  bytes: number;
  boards: BoardState;
}

export interface BackupMeta {
  id: number;
  createdAt: number;
  boardCount: number;
  bytes: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Property access on globalThis never throws in jsdom without the
    // fake-indexeddb polyfill — a bare `indexedDB` reference would.
    if (globalThis.indexedDB === undefined) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

/** Add a snapshot and rotate out anything beyond the newest `MAX_BACKUPS`. */
export async function createBackup(state: BoardState): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const done = transactionDone(tx);
    const payload = JSON.stringify(state);
    await requestResult(
      store.add({
        createdAt: Date.now(),
        boardCount: state.length,
        bytes: payload.length,
        boards: state,
      }),
    );
    // Rotation reads only the KEYS — `getAll()` would deserialize every
    // stored snapshot (tens of MB of board JSON) just to learn which ids to
    // drop. Keys are the autoIncrement ids, handed back in ascending order,
    // so insertion order is oldest-first and the head is the overflow.
    const keys = await requestResult(
      store.getAllKeys() as IDBRequest<IDBValidKey[]>,
    );
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS))) {
      store.delete(key);
    }
    await done;
  } finally {
    db.close();
  }
}

/** Metadata for every stored backup, newest first. */
export async function listBackups(): Promise<BackupMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const done = transactionDone(tx);
    const records = await requestResult(
      tx.objectStore(STORE_NAME).getAll() as IDBRequest<BackupRecord[]>,
    );
    await done;
    return records
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        boardCount: record.boardCount,
        bytes: record.bytes,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function loadBackup(id: number): Promise<BoardState | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const done = transactionDone(tx);
    const record = await requestResult(
      tx.objectStore(STORE_NAME).get(id) as IDBRequest<
        BackupRecord | undefined
      >,
    );
    await done;
    if (!record) return null;
    return normalizeBoards(record.boards);
  } finally {
    db.close();
  }
}

export async function deleteBackup(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(tx);
    await requestResult(tx.objectStore(STORE_NAME).delete(id));
    await done;
  } finally {
    db.close();
  }
}
