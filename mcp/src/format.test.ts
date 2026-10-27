import { describe, expect, it } from "vitest";

import { CHARACTER_LIMIT } from "./constants.js";
import { bullets, cap, formatTimestamp, respond, textOnly } from "./format.js";

describe("respond", () => {
  it("refuses an oversized JSON payload instead of truncating it", () => {
    const huge = { rows: "x".repeat(30_000) };
    const result = respond("json", huge, "# big", "Narrow it.");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Narrow it\./);
    expect(result.structuredContent).toBeUndefined();
  });

  it("renders markdown by default and attaches structured content", () => {
    const result = respond("markdown", { ok: true }, "# Title");
    expect(result.content[0]?.text).toBe("# Title");
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it("renders JSON when asked", () => {
    const result = respond("json", { a: 1 }, "# ignored");
    expect(result.content[0]?.text).toBe('{\n  "a": 1\n}');
  });

  it("drops structured content when the payload exceeds the budget", () => {
    const huge = { blob: "x".repeat(CHARACTER_LIMIT + 100) };
    const result = respond("markdown", huge, "# big");
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toBe("# big");
  });
});

describe("cap", () => {
  it("truncates past the character limit with a note", () => {
    const huge = "x".repeat(CHARACTER_LIMIT + 50);
    const capped = cap(huge);
    // The body is sliced to the budget, then a short note is appended.
    expect(capped).toContain("truncated");
    expect(capped.length).toBeLessThanOrEqual(CHARACTER_LIMIT + 200);
    expect(huge.slice(0, 100)).toBe(capped.slice(0, 100));
  });

  it("leaves a short string untouched", () => {
    expect(cap("short")).toBe("short");
  });
});

describe("textOnly", () => {
  it("returns a single text block", () => {
    const result = textOnly("done");
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("formatTimestamp", () => {
  it("renders an ISO-like stamp and a dash for null", () => {
    expect(formatTimestamp(Date.UTC(2026, 0, 2, 3, 4))).toBe(
      "2026-01-02 03:04",
    );
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(Number.NaN)).toBe("—");
  });
});

describe("bullets", () => {
  it("joins items and falls back when empty", () => {
    expect(bullets(["a", "b"])).toBe("- a\n- b");
    expect(bullets([])).toBe("_(none)_");
  });
});
