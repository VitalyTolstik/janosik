import { describe, expect, it } from "vitest";

import { formatBackupTimestamp } from "@/utils/backup-timestamp";

/**
 * Timestamp formatting for the backup list — relative for fresh backups,
 * clock time today, "Yesterday", then full date. Both locales.
 */

const NOW = new Date(2026, 8, 11, 14, 0).getTime(); // Sep 11 2026, 14:00 local

describe("formatBackupTimestamp", () => {
  it("shows relative minutes for fresh backups", () => {
    const ts = NOW - 5 * 60_000;
    expect(formatBackupTimestamp(ts, NOW, "en")).toMatch(/5 minutes? ago/);
    expect(formatBackupTimestamp(ts, NOW, "ru")).toMatch(/5 минут? назад/);
  });

  it("clamps future drift to '1 minute ago'", () => {
    const ts = NOW + 10 * 60_000; // clock skew
    expect(formatBackupTimestamp(ts, NOW, "en")).toMatch(/1 minute ago/);
  });

  it("shows clock time for today", () => {
    const ts = NOW - 3 * 3_600_000; // 11:00 same day
    expect(formatBackupTimestamp(ts, NOW, "en")).toBe("11:00");
    expect(formatBackupTimestamp(ts, NOW, "ru")).toBe("11:00");
  });

  it("prefaces yesterday with the word Yesterday", () => {
    const ts = new Date(2026, 8, 10, 9, 10).getTime();
    expect(formatBackupTimestamp(ts, NOW, "en")).toBe("Yesterday, 09:10");
    expect(formatBackupTimestamp(ts, NOW, "ru")).toBe("Вчера, 09:10");
  });

  it("falls back to full date and time for older backups", () => {
    const ts = new Date(2026, 7, 2, 8, 5).getTime(); // Aug 2 2026
    const en = formatBackupTimestamp(ts, NOW, "en");
    const ru = formatBackupTimestamp(ts, NOW, "ru");
    expect(en).toContain("2026");
    expect(en).toContain("08:05");
    expect(ru).toContain("2026");
    expect(ru).toContain("08:05");
  });
});
