import { describe, expect, it } from "vitest";
import { BOARD_TEMPLATES, LIMITS } from "@janosik/shared";

import {
  boardNameContext,
  boardNameIsDuplicate,
  clampBoardName,
  dedupeBoardName,
  generateBoardName,
  isoWeek,
  normalizeBoardTitle,
} from "@/utils/board-name";

const NOV_24 = new Date(2026, 10, 24, 12, 0, 0);

function template(id: string) {
  return BOARD_TEMPLATES.find((candidate) => candidate.id === id)!;
}

describe("first-run board names", () => {
  it("formats the day, ISO week and month context", () => {
    expect(boardNameContext("day", NOV_24, "en")).toBe("Nov 24");
    expect(boardNameContext("day", NOV_24, "ru")).toBe("24 нояб.");
    expect(boardNameContext("iso-week", NOV_24, "en")).toBe("2026-W48");
    expect(boardNameContext("month", NOV_24, "en")).toBe("November 2026");
    expect(boardNameContext("month", NOV_24, "ru")).toBe("ноябрь 2026");
    expect(boardNameContext("none", NOV_24, "en")).toBe("");
  });

  it("generates the documented names", () => {
    expect(
      generateBoardName(template("product-launch"), "en", NOV_24, []).name,
    ).toBe("Product launch — Nov 24");
    expect(
      generateBoardName(template("product-launch"), "ru", NOV_24, []).name,
    ).toBe("Запуск продукта — 24 нояб.");
    expect(generateBoardName(template("sprint"), "en", NOV_24, []).name).toBe(
      "Sprint board 2026-W48",
    );
    expect(
      generateBoardName(template("content-calendar"), "ru", NOV_24, []).name,
    ).toBe("Контент-план — ноябрь 2026");
    expect(generateBoardName(template("personal"), "en", NOV_24, []).name).toBe(
      "Personal tasks",
    );
  });

  it("dedupes against active and archived titles case-insensitively", () => {
    const first = generateBoardName(template("personal"), "en", NOV_24, [
      "Personal tasks",
    ]);
    expect(first).toMatchObject({
      name: "Personal tasks (2)",
      deduped: true,
      dedupeIndex: 2,
    });
    const second = generateBoardName(template("personal"), "en", NOV_24, [
      "Personal tasks",
      " personal   tasks (2) ",
    ]);
    expect(second.name).toBe("Personal tasks (3)");
    expect(second.dedupeIndex).toBe(3);
  });

  it("normalizes for comparison without changing the display value", () => {
    expect(normalizeBoardTitle("  Ｐersonal   tasks ", "en")).toBe(
      "personal tasks",
    );
    expect(
      boardNameIsDuplicate("  personal tasks ", ["Personal tasks"], "en"),
    ).toBe(true);
    expect(
      boardNameIsDuplicate("Personal  tasks 2", ["Personal tasks"], "en"),
    ).toBe(false);
    expect(boardNameIsDuplicate("   ", ["Personal tasks"], "en")).toBe(false);
  });

  it("keeps names within the server limit without splitting emoji", () => {
    const long = "🚀".repeat(80);
    const clamped = clampBoardName(long, LIMITS.boardTitle);
    expect(clamped.length).toBeLessThanOrEqual(LIMITS.boardTitle);
    expect(clamped.endsWith("…")).toBe(true);
    expect(clamped.includes("\uFFFD")).toBe(false);
    expect(/[\uD800-\uDBFF]$/.test(clamped)).toBe(false);

    const deduped = dedupeBoardName(
      long,
      [clampBoardName(long, LIMITS.boardTitle)],
      "en",
    );
    expect(deduped.name.length).toBeLessThanOrEqual(LIMITS.boardTitle);
    expect(deduped.name.endsWith("(2)")).toBe(true);
  });

  it("computes ISO weeks across a year boundary", () => {
    expect(isoWeek(new Date(2027, 0, 1, 12, 0, 0))).toBe("2026-W53");
    expect(isoWeek(new Date(2026, 0, 1, 12, 0, 0))).toBe("2026-W01");
  });
});
