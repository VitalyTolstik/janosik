import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBackup,
  deleteBackup,
  listBackups,
  loadBackup,
  MAX_BACKUPS,
} from "@/utils/backup";
import { initialBoardState } from "@janosik/shared";

/**
 * Tests for IndexedDB-based automatic backups: create/list/load/delete and
 * rotation of old snapshots beyond the configured maximum.
 *
 * `fake-indexeddb/auto` provides an in-memory IndexedDB for jsdom, so these
 * run without a real browser.
 */

describe("backups", () => {
  afterEach(async () => {
    // Drop the whole database between tests.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("janosik-backups");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("creates and lists a backup", async () => {
    await createBackup(initialBoardState());
    const backups = await listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].boardCount).toBe(1);
  });

  it("records the byte size of the snapshot, not the string length", async () => {
    const state = initialBoardState();
    state[0] = { ...state[0], title: "План запуска" };
    await createBackup(state);

    const [meta] = await listBackups();
    const payload = JSON.stringify(state);
    // Cyrillic is 2 bytes per character in UTF-8; the stored `bytes` must be
    // the real storage cost, not the code-unit count.
    expect(payload.length).not.toBe(new TextEncoder().encode(payload).length);
    expect(meta.bytes).toBe(new TextEncoder().encode(payload).length);
  });

  it("loads back the full board state", async () => {
    const state = initialBoardState();
    await createBackup(state);
    const [meta] = await listBackups();
    const loaded = await loadBackup(meta.id);
    expect(loaded).toEqual(state);
  });

  it("rotates old backups beyond the maximum, keeping the newest", async () => {
    const state = initialBoardState();
    // Slightly more than the cap.
    for (let i = 0; i < MAX_BACKUPS + 5; i++) {
      await createBackup(state);
    }
    const backups = await listBackups();
    expect(backups.length).toBe(MAX_BACKUPS);
    // Rotation drops the head of the key order (TASK-21.4): the surviving
    // ids must be the last MAX_BACKUPS ones written, not an arbitrary set.
    const ids = backups.map((backup) => backup.id).sort((a, b) => a - b);
    expect(ids[ids.length - 1]).toBe(MAX_BACKUPS + 5);
    expect(ids[0]).toBe(6);
  });

  it("deletes a backup", async () => {
    await createBackup(initialBoardState());
    const [meta] = await listBackups();
    await deleteBackup(meta.id);
    const backups = await listBackups();
    expect(backups).toHaveLength(0);
  });

  it("returns null for a missing backup id", async () => {
    expect(await loadBackup(999999)).toBeNull();
  });
});
