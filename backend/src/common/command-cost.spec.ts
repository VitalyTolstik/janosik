import { commandRateLimitCost } from "./command-cost";

describe("commandRateLimitCost (TASK-200.3)", () => {
  it("charges a single command as one unit", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands",
        body: { action: { type: "RENAME_BOARD" } },
      }),
    ).toBe(1);
  });

  it("charges a batch by its command count", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: { commands: [{}, {}, {}] },
      }),
    ).toBe(3);
  });

  it("charges a plan apply by its command count too", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/plans/apply?dryRun=0",
        body: { commands: [{}, {}] },
      }),
    ).toBe(2);
  });

  it("clamps malformed or oversized bodies to the published batch bound", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: { commands: Array.from({ length: 500 }, () => ({})) },
      }),
    ).toBe(100);
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: { commands: [] },
      }),
    ).toBe(1);
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: undefined,
      }),
    ).toBe(1);
  });

  it("ignores reads and unrelated writes", () => {
    expect(
      commandRateLimitCost({
        method: "GET",
        originalUrl: "/api/v1/boards/b1/commands",
      }),
    ).toBe(1);
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/cards",
        body: { commands: [{}, {}] },
      }),
    ).toBe(1);
  });
});
