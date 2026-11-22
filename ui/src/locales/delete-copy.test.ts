import { describe, expect, it } from "vitest";

import en from "./en/translation.json";
import ru from "./ru/translation.json";

/**
 * TASK-177.7 (G-15): delete is a soft delete and stays reversible for the
 * retention window. The dialogs must not promise immediate permanence; the
 * honest copy names the administrator restore path.
 */
const COPY_KEYS = [
  "card.deleteDescription",
  "card.deleteForeverDescription",
  "column.deleteDescription",
  "comment.deleteDescription",
  "card.attachments.deleteWarning",
  "board.switcher.deleteConfirm",
  "archive.deleteConfirm",
  "archive.bulkDeleteDescription",
] as const;

function variants(
  catalog: Record<string, string>,
  base: string,
): Array<[string, string]> {
  return Object.entries(catalog).filter(
    ([key]) => key === base || key.startsWith(`${base}_`),
  );
}

describe("delete copy (TASK-177.7)", () => {
  it.each(COPY_KEYS)("%s says an administrator can restore it", (base) => {
    for (const [catalogName, catalog] of [
      ["en", en as Record<string, string>],
      ["ru", ru as Record<string, string>],
    ] as const) {
      const rows = variants(catalog, base);
      expect(rows.length, `${catalogName} ${base}`).toBeGreaterThan(0);
      for (const [key, value] of rows) {
        expect(value.toLowerCase(), `${catalogName} ${key}`).toMatch(
          catalogName === "en"
            ? /administrator can restore/
            : /администратор может восстановить/,
        );
        expect(value.toLowerCase(), `${catalogName} ${key}`).not.toMatch(
          /cannot be undone|permanently|безвозвратно|нельзя отменить/,
        );
      }
    }
  });
});
