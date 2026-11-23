import { BadRequestException } from "@nestjs/common";
import { BOARD_ACTION_TYPES } from "@janosik/shared";
import { ACTION_REGISTRY, validateCommandAction } from "./command-validation";

/**
 * TASK-200.3: `commandRateLimitCost` uses the shared runtime list to avoid
 * charging a 100-command batch for a malformed/unknown action. This guard keeps
 * the backend registry and that list from drifting silently.
 */
describe("shared BOARD_ACTION_TYPES", () => {
  it("matches every action the command transport accepts, in both directions", () => {
    const backend = new Set(Object.keys(ACTION_REGISTRY));
    const shared = new Set<string>(BOARD_ACTION_TYPES);
    expect([...backend].filter((type) => !shared.has(type))).toEqual([]);
    expect([...shared].filter((type) => !backend.has(type))).toEqual([]);
  });
});

describe("deep command actions", () => {
  it("answers a generic 400 when the action cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let error: unknown;
    try {
      validateCommandAction({
        type: "RENAME_BOARD",
        title: "deep",
        at: Date.now(),
        deep: circular,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse();
    expect(response).toMatchObject({ field: "action" });
    expect(JSON.stringify(response)).not.toContain("Maximum call stack");
  });
});
