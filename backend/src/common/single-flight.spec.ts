import { SingleFlight, SingleFlightTimeoutError } from "./single-flight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SingleFlight", () => {
  it("coalesces concurrent calls with the same key", async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    const task = jest.fn(() => gate.promise);
    const joins = jest.fn();

    const first = flight.run("board:a", task, { onJoin: joins });
    const second = flight.run("board:a", task, { onJoin: joins });
    const third = flight.run("board:a", task, { onJoin: joins });
    expect(flight.size).toBe(1);
    gate.resolve("snapshot");

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "snapshot",
      "snapshot",
      "snapshot",
    ]);
    expect(task).toHaveBeenCalledTimes(1);
    expect(joins).toHaveBeenCalledTimes(2);
    expect(flight.size).toBe(0);
  });

  it("keeps different keys independent", async () => {
    const flight = new SingleFlight<string>();
    const taskA = jest.fn().mockResolvedValue("a");
    const taskB = jest.fn().mockResolvedValue("b");

    await expect(
      Promise.all([flight.run("board:a", taskA), flight.run("board:b", taskB)]),
    ).resolves.toEqual(["a", "b"]);
    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
  });

  it("rejects every waiter on failure and lets the next call retry", async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    const failing = jest.fn(() => gate.promise);

    const first = flight.run("board:a", failing);
    const second = flight.run("board:a", failing);
    gate.reject(new Error("database unavailable"));

    await expect(first).rejects.toThrow("database unavailable");
    await expect(second).rejects.toThrow("database unavailable");
    expect(flight.size).toBe(0);

    const retry = jest.fn().mockResolvedValue("fresh");
    await expect(flight.run("board:a", retry)).resolves.toBe("fresh");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("times out one caller without poisoning the shared task", async () => {
    const flight = new SingleFlight<string>();
    const gate = deferred<string>();
    const task = jest.fn(() => gate.promise);

    const impatient = flight.run("board:a", task, { timeoutMs: 10 });
    await expect(impatient).rejects.toBeInstanceOf(SingleFlightTimeoutError);
    // The task is still running for the caller that has not timed out.
    expect(flight.size).toBe(1);

    const patient = flight.run("board:a", task, { timeoutMs: 1_000 });
    gate.resolve("late");
    await expect(patient).resolves.toBe("late");
    expect(task).toHaveBeenCalledTimes(1);
    expect(flight.size).toBe(0);
  });

  it("does not cache a settled result", async () => {
    const flight = new SingleFlight<number>();
    const task = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await expect(flight.run("k", task)).resolves.toBe(1);
    await expect(flight.run("k", task)).resolves.toBe(2);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
