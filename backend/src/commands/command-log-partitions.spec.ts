import {
  addMonths,
  commandPartitionName,
  isWholeMonthExpired,
  monthBounds,
  monthSuffix,
  parseCommandPartitionMonth,
  partitionMonthsToEnsure,
  utcMonthStart,
} from "@/commands/command-log-partitions";

/** TASK-200.11 pure naming/arithmetic for the monthly partitions. */
describe("command log partitions", () => {
  it("uses UTC month boundaries", () => {
    const at = new Date("2026-11-30T23:59:59.999Z");
    expect(utcMonthStart(at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthBounds(at)).toEqual({
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-12-01T00:00:00.000Z"),
    });
  });

  it("moves across a year and formats the catalog suffix", () => {
    const december = utcMonthStart(new Date("2026-12-15T12:00:00Z"));
    expect(addMonths(december, 1).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(addMonths(december, -2).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(monthSuffix(december)).toBe("202612");
    expect(commandPartitionName("CommandDetail", december)).toBe(
      "CommandDetail_202612",
    );
  });

  it("pre-creates the previous, current and three future months", () => {
    const months = partitionMonthsToEnsure(
      new Date("2026-11-23T12:00:00Z"),
    ).map(monthSuffix);
    expect(months).toEqual(["202610", "202611", "202612", "202701", "202702"]);
  });

  it("recognises only a real monthly child, never the default", () => {
    expect(
      parseCommandPartitionMonth("Command", "Command_202611")?.toISOString(),
    ).toBe("2026-11-01T00:00:00.000Z");
    expect(parseCommandPartitionMonth("Command", "Command_default")).toBeNull();
    expect(
      parseCommandPartitionMonth("Command", "CommandDetail_202611"),
    ).toBeNull();
    expect(parseCommandPartitionMonth("Command", "Command_202613")).toBeNull();
    expect(parseCommandPartitionMonth("Command", "Command_20261")).toBeNull();
  });

  it("only expires a month when its whole range is older than the cutoff", () => {
    const month = new Date("2026-10-01T00:00:00.000Z");
    expect(
      isWholeMonthExpired(month, new Date("2026-11-01T00:00:00.000Z")),
    ).toBe(true);
    expect(
      isWholeMonthExpired(month, new Date("2026-10-31T23:59:59.999Z")),
    ).toBe(false);
    expect(
      isWholeMonthExpired(month, new Date("2026-09-01T00:00:00.000Z")),
    ).toBe(false);
  });
});
