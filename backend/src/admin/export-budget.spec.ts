import {
  addBoardToBundleBudget,
  assertBundleBudget,
  BundleTooLargeException,
} from "./export-budget";

describe("account bundle budget (TASK-166.6)", () => {
  it("accepts a board that fits and returns the next total", () => {
    expect(addBoardToBundleBudget(0, 20 * 1024 * 1024)).toBe(20 * 1024 * 1024);
    expect(addBoardToBundleBudget(20 * 1024 * 1024, 10 * 1024 * 1024)).toBe(
      30 * 1024 * 1024,
    );
  });

  it("throws BundleTooLargeException when the combined budget is exceeded", () => {
    expect(() =>
      addBoardToBundleBudget(49 * 1024 * 1024, 2 * 1024 * 1024),
    ).toThrow(BundleTooLargeException);
    expect(() => assertBundleBudget(51 * 1024 * 1024)).toThrow(
      BundleTooLargeException,
    );
  });
});
