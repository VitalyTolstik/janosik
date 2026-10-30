import { consumeTokenRate, resetTokenRates } from "./token-rate-limit";

describe("consumeTokenRate (TASK-157)", () => {
  beforeEach(() => resetTokenRates());

  it("allows up to the limit then refuses", () => {
    expect(consumeTokenRate("t-1", 2)).toBe(true);
    expect(consumeTokenRate("t-1", 2)).toBe(true);
    expect(consumeTokenRate("t-1", 2)).toBe(false);
  });

  it("keeps separate budgets per token", () => {
    expect(consumeTokenRate("t-1", 1)).toBe(true);
    expect(consumeTokenRate("t-1", 1)).toBe(false);
    expect(consumeTokenRate("t-2", 1)).toBe(true);
  });

  it("resets after the window", () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(now);
    expect(consumeTokenRate("t-1", 1)).toBe(true);
    expect(consumeTokenRate("t-1", 1)).toBe(false);
    spy.mockReturnValue(now + 60_001);
    expect(consumeTokenRate("t-1", 1)).toBe(true);
    spy.mockRestore();
  });
});
