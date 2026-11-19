import { parsePositiveInt } from "./env";

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
