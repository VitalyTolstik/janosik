import { readCommandLogStats } from "@/admin/command-log-stats";

/**
 * TASK-200.11: command-log partition health. Partition rows/size/dead tuples
 * are catalog estimates; the default partitions are counted exactly. The SQL
 * itself is also exercised against PostgreSQL by the command-log e2e spec.
 */
describe("command log stats", () => {
  it("maps partition estimates and sums exact default-partition counts", async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          parent: "Command",
          name: "Command_202611",
          rows: 12_345n,
          sizeBytes: 9_000_000n,
          deadRows: 42n,
          lastVacuumAt: new Date("2026-11-22T00:00:00Z"),
          lastAutovacuumAt: null,
        },
        {
          parent: "Command",
          name: "Command_default",
          rows: 0n,
          sizeBytes: 8_192n,
          deadRows: 0n,
          lastVacuumAt: null,
          lastAutovacuumAt: null,
        },
      ])
      .mockResolvedValueOnce([{ command: 3n, detail: 1n, preimage: 0n }])
      .mockResolvedValueOnce([
        {
          rows: 10n,
          sizeBytes: 65_536n,
          deadRows: 2n,
          lastVacuumAt: new Date("2026-11-21T00:00:00Z"),
          lastAutovacuumAt: null,
        },
      ]);
    const stats = await readCommandLogStats(
      { $queryRaw: queryRaw } as never,
      30,
    );
    expect(stats.available).toBe(true);
    expect(stats.retentionDays).toBe(30);
    expect(stats.partitions[0]).toMatchObject({
      rows: 12_345,
      sizeBytes: 9_000_000,
      deadRows: 42,
      lastVacuumAt: new Date("2026-11-22T00:00:00Z").getTime(),
    });
    // Exact count, not the reltuples estimate on the default partition.
    expect(stats.defaultRows).toBe(4);
    expect(stats.registry).toMatchObject({
      rows: 10,
      sizeBytes: 65_536,
      deadRows: 2,
      lastVacuumAt: new Date("2026-11-21T00:00:00Z").getTime(),
    });
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });
});
