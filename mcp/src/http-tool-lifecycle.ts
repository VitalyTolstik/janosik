/**
 * Per-request tool lifecycle tracking for the HTTP gateway.
 *
 * `transport.handleRequest` may resolve when the HTTP client disconnects even
 * though a tool handler is still running. The gateway holds its body slot and
 * session activity until every tool promise started by that POST settles.
 *
 * The wrapper is installed on the gateway-created McpServer only; stdio has no
 * AsyncLocalStorage store and pays nothing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export class ToolTracker {
  private active = 0;
  private readonly idleWaiters = new Set<() => void>();

  start(): void {
    this.active += 1;
  }

  end(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active === 0) {
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  async waitForIdle(): Promise<void> {
    if (this.active === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  get inFlight(): number {
    return this.active;
  }
}

export const toolRequestContext = new AsyncLocalStorage<ToolTracker>();
const instrumentedServers = new WeakSet<McpServer>();

/**
 * Wrap every registered tool handler so it reports start/end to the tracker in
 * the current AsyncLocalStorage context. Call after the tools are registered.
 */
export function installToolTracking(server: McpServer): void {
  if (instrumentedServers.has(server)) return;
  instrumentedServers.add(server);
  const runtime = server as unknown as {
    _registeredTools?: Record<
      string,
      { handler?: (...args: unknown[]) => unknown }
    >;
  };
  for (const tool of Object.values(runtime._registeredTools ?? {})) {
    const original = tool.handler;
    if (typeof original !== "function") continue;
    tool.handler = async (...args: unknown[]) => {
      const tracker = toolRequestContext.getStore();
      if (tracker === undefined) return original(...args);
      tracker.start();
      try {
        return await original(...args);
      } finally {
        tracker.end();
      }
    };
  }
}
