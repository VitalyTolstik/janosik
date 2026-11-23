import {
  AGENT_BUDGET_MAX,
  AGENT_BUDGET_MIN,
  parseAgentBudget,
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

  it("guards the TASK-200.5 TTLs and cache bounds against negatives", () => {
    for (const value of ["-1", "-15000"]) {
      expect(() => parseNonNegativeInt(value)).toThrow(/non-negative/i);
    }
    // The cache env fields all use this validator; 0 means "disabled" and a
    // positive whole number is a valid window/entry bound.
    expect(parseNonNegativeInt("30000")).toBe(30_000);
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

/** TASK-200.3: a pinned budget must fit at least one 100-command batch. */
describe("parseAgentBudget", () => {
  it("accepts auto (0) and a budget that can fit the largest batch", () => {
    expect(parseAgentBudget("0")).toBe(0);
    expect(parseAgentBudget(String(AGENT_BUDGET_MIN))).toBe(AGENT_BUDGET_MIN);
    expect(parseAgentBudget(String(AGENT_BUDGET_MAX))).toBe(AGENT_BUDGET_MAX);
  });

  it("rejects 1…99 because a valid batch could never fit", () => {
    expect(AGENT_BUDGET_MIN).toBe(100);
    for (const value of ["1", "60", "99", "-1", "1.5", "abc"]) {
      expect(() => parseAgentBudget(value)).toThrow();
    }
    expect(() => parseAgentBudget(String(AGENT_BUDGET_MAX + 1))).toThrow();
  });
});
