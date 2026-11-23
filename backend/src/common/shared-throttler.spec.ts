import { createSharedThrottlerStorage } from "./shared-throttler";

/**
 * TASK-200.12: the Redis throttler is opt-in. An empty REDIS_URL must leave
 * the stock in-process storage untouched; a configured one builds the shared
 * adapter and can be closed without opening a connection.
 */
describe("createSharedThrottlerStorage", () => {
  it("stays off when REDIS_URL is empty (single-replica default)", () => {
    expect(createSharedThrottlerStorage("")).toBeUndefined();
    expect(createSharedThrottlerStorage("   ")).toBeUndefined();
  });

  it("builds a closable shared adapter when a URL is configured", async () => {
    const shared = createSharedThrottlerStorage("redis://127.0.0.1:1");
    expect(shared).toBeDefined();
    await shared?.storage.close();
    expect(shared?.client.status).toBe("end");
  });
});
