import { parseNonNegativeInt, parsePositiveInt } from "./env";

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

/** TASK-200.3: the agent budget knobs are 0-or-positive, never negative. */
describe("parseNonNegativeInt", () => {
  it("accepts zero and positive whole numbers", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parseNonNegativeInt("12000")).toBe(12_000);
  });

  it("rejects negatives, fractions and non-numbers", () => {
    for (const value of ["-1", "1.5", "abc", ""]) {
      expect(() => parseNonNegativeInt(value)).toThrow();
    }
  });
});
