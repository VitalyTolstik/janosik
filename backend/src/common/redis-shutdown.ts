/**
 * The shutdown slice of an ioredis client. Some services hold a lazy client
 * that may never have connected; closing it must not open a socket, and a
 * dead Redis must not hold a rolling replica restart hostage.
 */
export type RedisShutdownClient = {
  status?: string;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
};

/**
 * Bounded graceful close for ioredis clients (TASK-200.12).
 *
 * `quit()` waits for pending replies and can hang while Redis is unreachable;
 * a Compose replica then waits out `stop_grace_period` and is SIGKILLed.
 * After `timeoutMs` (default 1 s) the socket is disconnected instead. A lazy,
 * never-used client (`status === "wait"`) is disconnected without connecting.
 */
export async function quitRedis(
  client: RedisShutdownClient | null | undefined,
  timeoutMs = 1_000,
): Promise<void> {
  if (client === null || client === undefined) return;
  if (client.status === "wait" || client.status === "end") {
    client.disconnect?.();
    return;
  }
  const quit = client.quit;
  if (typeof quit === "function") {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(1, timeoutMs));
      timer.unref?.();
      void quit
        .call(client)
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  }
  client.disconnect?.();
}
