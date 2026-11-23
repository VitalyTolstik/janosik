import { commandBodyBytes, commandRateLimitCost } from "./command-cost";
import { COMMAND_BATCH_MAX } from "@janosik/shared";

function batch(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    commandId: `cmd-${index}`,
    action: { type: "RENAME_BOARD" },
  }));
}

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
        body: { commands: batch(3) },
      }),
    ).toBe(3);
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: { commands: batch(COMMAND_BATCH_MAX) },
      }),
    ).toBe(COMMAND_BATCH_MAX);
  });

  it("charges a plan apply by its command count too", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/plans/apply?dryRun=0",
        body: { commands: batch(2) },
      }),
    ).toBe(2);
  });

  it("charges malformed or oversized bodies as one unit, never the length", () => {
    for (const body of [
      { commands: Array.from({ length: 500 }, () => ({})) },
      { commands: batch(COMMAND_BATCH_MAX + 1) },
      { commands: [] },
      { commands: "not-an-array" },
      { commands: [{ commandId: "", action: { type: "RENAME_BOARD" } }] },
      { commands: [{ commandId: "cmd-1" }] },
      { commands: [{ commandId: "cmd-1", action: null }] },
      { commands: [{ commandId: "cmd-1", action: { type: "BOGUS" } }] },
      undefined,
    ]) {
      expect(
        commandRateLimitCost({
          method: "POST",
          originalUrl: "/api/v1/boards/b1/commands/batch",
          body,
        }),
      ).toBe(1);
    }
  });

  it("knows every real action type and rejects an unknown one cheaply", () => {
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: { commands: batch(100) },
      }),
    ).toBe(100);
    expect(
      commandRateLimitCost({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        body: {
          commands: [
            { commandId: "cmd-1", action: { type: "RENAME_BOARD" } },
            { commandId: "cmd-2", action: { type: "NOT_A_COMMAND" } },
          ],
        },
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
        body: { commands: batch(2) },
      }),
    ).toBe(1);
  });

  it("always measures serialized parsed JSON and ignores Content-Length", () => {
    const body = { commands: batch(2) };
    const measured = Buffer.byteLength(JSON.stringify(body));
    expect(
      commandBodyBytes({
        headers: { "content-length": "2048" },
        body,
      }),
    ).toBe(measured);
    expect(
      commandBodyBytes({
        headers: { "content-length": ["12", "12"] },
        body,
      }),
    ).toBe(measured);
    expect(commandBodyBytes({ body: "abc" })).toBe(5);
    expect(commandBodyBytes({})).toBe(0);
  });

  it("measures compressed and identity bodies by serialized parsed JSON", () => {
    const body = { commands: batch(100) };
    const measured = Buffer.byteLength(JSON.stringify(body));
    for (const encoding of ["gzip", "br", "deflate", "zstd", "identity"]) {
      expect(
        commandBodyBytes({
          headers: {
            "content-encoding": encoding,
            "content-length": "64",
          },
          body,
        }),
      ).toBe(measured);
    }
  });
});
