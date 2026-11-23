import {
  parseBoundedNonNegativeInt,
  parseNonNegativeInt,
  parsePositiveInt,
} from "./env";

/**
 * M3 (TASK-180.3): the unverified-account release window must be a positive
 * number of days. Zero/negative would make every pending registration
 * immediately eligible for deletion.
 */
describe("parsePositiveInt", () => {
  it("accepts a positive whole number", () => {
    expect(parsePositiveInt("14")).toBe(14);
  });

  it("rejects zero, negatives, fractions and non-numbers", () => {
    for (const value of ["0", "-1", "1.5", "abc", ""]) {
      expect(() => parsePositiveInt(value)).toThrow();
    }
  });
});

/** TASK-156/200.3: existing knobs keep empty → 0; agent knobs add a bound. */
describe("parseNonNegativeInt", () => {
  it("accepts zero, positive whole numbers and the legacy empty value", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parseNonNegativeInt("12000")).toBe(12_000);
    // `DB_CONNECTION_LIMIT=` and `MAX_BOARDS_PER_USER=` have always meant 0.
    expect(parseNonNegativeInt("")).toBe(0);
    expect(parseNonNegativeInt("  ")).toBe(0);
  });

  it("rejects negatives, fractions and non-numbers", () => {
    for (const value of ["-1", "1.5", "abc"]) {
      expect(() => parseNonNegativeInt(value)).toThrow();
    }
  });
});

describe("parseBoundedNonNegativeInt", () => {
  it("accepts values inside the bound, including zero and the maximum", () => {
    expect(parseBoundedNonNegativeInt("0", 30_000)).toBe(0);
    expect(parseBoundedNonNegativeInt("30000", 30_000)).toBe(30_000);
    expect(parseBoundedNonNegativeInt("", 30_000)).toBe(0);
  });

  it("rejects a value over the bound instead of silently loosening a guard", () => {
    expect(() => parseBoundedNonNegativeInt("30001", 30_000)).toThrow(
      /no greater than 30000/,
    );
  });
});
