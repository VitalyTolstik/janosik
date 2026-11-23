import { BOARD_ACTION_TYPES } from "@janosik/shared";
import { ACTION_REGISTRY } from "./command-validation";

/**
 * TASK-200.3: `commandRateLimitCost` uses the shared runtime list to avoid
 * charging a 100-command batch for a malformed/unknown action. This guard keeps
 * the backend registry and that list from drifting silently.
 */
describe("shared BOARD_ACTION_TYPES", () => {
  it("contains every action the command transport accepts", () => {
    const missing = Object.keys(ACTION_REGISTRY).filter(
      (type) => !(BOARD_ACTION_TYPES as readonly string[]).includes(type),
    );
    expect(missing).toEqual([]);
  });
});
