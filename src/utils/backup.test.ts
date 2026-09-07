import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBackup,
  deleteBackup,
  listBackups,
  loadBackup,
  MAX_BACKUPS,
} from "@/utils/backup";
import { initialBoardState } from "@/store/board-reducer";

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

  it("loads back the full board state", async () => {
    const state = initialBoardState();
    await createBackup(state);
    const [meta] = await listBackups();
    const loaded = await loadBackup(meta.id);
    expect(loaded).toEqual(state);
  });

  it("rotates old backups beyond the maximum", async () => {
    const state = initialBoardState();
    // Slightly more than the cap.
    for (let i = 0; i < MAX_BACKUPS + 5; i++) {
      await createBackup(state);
    }
    const backups = await listBackups();
    expect(backups.length).toBeLessThanOrEqual(MAX_BACKUPS);
    expect(backups.length).toBe(MAX_BACKUPS);
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