import { quitRedis } from "./redis-shutdown";

describe("quitRedis (TASK-200.12)", () => {
  it("does not open a lazy connection just to close it", async () => {
    const quit = jest.fn().mockResolvedValue("OK");
    const disconnect = jest.fn();
    await quitRedis({ quit, disconnect, status: "wait" });
    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("quits a live client and then closes the socket", async () => {
    const quit = jest.fn().mockResolvedValue("OK");
    const disconnect = jest.fn();
    await quitRedis({ quit, disconnect, status: "ready" });
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("falls back to disconnect when quit does not settle", async () => {
    const quit = jest.fn(() => new Promise(() => undefined));
    const disconnect = jest.fn();
    const started = Date.now();
    await quitRedis({ quit, disconnect, status: "ready" }, 20);
    expect(Date.now() - started).toBeLessThan(500);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
