import { BadRequestException } from "@nestjs/common";
import { parseSince } from "./parse-since";

/**
 * TASK-156 (item 43): the parsed value is later cast with `BigInt(since)`
 * into the `Command.seq` bigint column. Anything a PostgreSQL bigint cannot
 * hold — or that a JS number cannot hold exactly — must die here as a 400,
 * not inside Prisma as a 500 on the delta endpoint, the events stream or
 * the public share stream.
 */
describe("parseSince", () => {
  it("returns 0 when the query is absent or empty", () => {
    expect(parseSince(undefined)).toBe(0);
    expect(parseSince("")).toBe(0);
  });

  it("accepts a non-negative safe integer", () => {
    expect(parseSince("0")).toBe(0);
    expect(parseSince("1")).toBe(1);
    expect(parseSince("42")).toBe(42);
    expect(parseSince("9007199254740991")).toBe(9007199254740991);
  });

  it.each([
    ["1e30"],
    ["1e21"],
    ["9223372036854775808"],
    ["9007199254740992"],
    ["-1"],
    ["-0.5"],
    ["1.5"],
    ["Infinity"],
    ["NaN"],
    ["abc"],
  ])("rejects %s with 400", (raw) => {
    expect(() => parseSince(raw)).toThrow(BadRequestException);
  });

  it("never admits a value that would overflow the bigint column", () => {
    // The invariant behind the guard: the largest accepted value stays a
    // safe integer, which is far inside PostgreSQL's bigint range.
    expect(BigInt(parseSince("9007199254740991"))).toBeLessThanOrEqual(
      9223372036854775807n,
    );
  });
});
