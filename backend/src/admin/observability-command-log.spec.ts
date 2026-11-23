import { ObservabilityService } from "@/admin/observability.service";

/**
 * TASK-200.11: the observability snapshot exposes command-log partition
 * health from the catalog. The query itself is covered against PostgreSQL by
 * the migration/e2e checks; here we pin the BigInt/Date mapping and the
 * default-partition warning counter.
 */
describe("ObservabilityService command log", () => {
  it("maps partition estimates, dead tuples and vacuum timestamps", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
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
        rows: 3n,
        sizeBytes: 8_192n,
        deadRows: 0n,
        lastVacuumAt: null,
        lastAutovacuumAt: null,
      },
    ]);
    const service = new ObservabilityService(
      { $queryRaw: queryRaw } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { retentionDays: jest.fn().mockResolvedValue(30) } as never,
    );
    const stats = await (
      service as unknown as {
        commandLogStats(): Promise<{
          available: boolean;
          retentionDays: number;
          partitions: Array<{
            rows: number;
            sizeBytes: number;
            deadRows: number;
            lastVacuumAt: number | null;
          }>;
          defaultRows: number;
        }>;
      }
    ).commandLogStats();
    expect(stats.available).toBe(true);
    expect(stats.retentionDays).toBe(30);
    expect(stats.partitions[0]).toMatchObject({
      rows: 12_345,
      sizeBytes: 9_000_000,
      deadRows: 42,
      lastVacuumAt: new Date("2026-11-22T00:00:00Z").getTime(),
    });
    expect(stats.defaultRows).toBe(3);
  });

  it("falls back to the configured retention when the panel has no override", async () => {
    const service = new ObservabilityService(
      { $queryRaw: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { retentionDays: jest.fn().mockResolvedValue(null) } as never,
    );
    const stats = await (
      service as unknown as {
        commandLogStats(): Promise<{ retentionDays: number }>;
      }
    ).commandLogStats();
    expect(stats.retentionDays).toBe(30);
  });
});
