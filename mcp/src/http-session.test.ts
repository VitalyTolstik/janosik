import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";

import { createBufferLogger } from "./http-log.js";
import {
  SessionManager,
  fingerprintToken,
  sessionMatchesToken,
  type OpenSessionResult,
} from "./http-session.js";

const managers: SessionManager[] = [];

function makeManager(
  overrides: Partial<ConstructorParameters<typeof SessionManager>[0]> = {},
): SessionManager {
  const { logger } = createBufferLogger({ level: "error" });
  const manager = new SessionManager({
    maxSessions: 10,
    maxSessionsPerToken: 0,
    idleMs: 60_000,
    sweepMs: 0,
    createMcpServer: () =>
      new McpServer({ name: "session-test", version: "0.0.0" }),
    logger,
    ...overrides,
  });
  managers.push(manager);
  return manager;
}

function opened(result: OpenSessionResult) {
  if (!result.ok) throw new Error(`session was not opened: ${result.reason}`);
  return result.session;
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
});

describe("SessionManager", () => {
  it("reserves sessions and exposes only id/token metadata", async () => {
    const manager = makeManager();
    const session = opened(await manager.open("jnk_alpha_secret"));
    expect(session.id).toBeNull();
    expect(session.tokenHash).toBe(fingerprintToken("jnk_alpha_secret"));
    expect(session.tokenHash).not.toContain("jnk_alpha_secret");
    expect(manager.stats()).toMatchObject({ sessions: 0, pending: 1 });
    expect(sessionMatchesToken(session, "jnk_alpha_secret")).toBe(true);
    expect(sessionMatchesToken(session, "jnk_beta_secret")).toBe(false);
    await manager.close(session, "test");
    expect(manager.stats()).toMatchObject({ sessions: 0, pending: 0 });
  });

  it("enforces the global session cap before creating a server", async () => {
    let created = 0;
    const manager = makeManager({
      maxSessions: 2,
      createMcpServer: () => {
        created += 1;
        return new McpServer({ name: "session-test", version: "0.0.0" });
      },
    });
    expect((await manager.open("jnk_a_secret")).ok).toBe(true);
    expect((await manager.open("jnk_b_secret")).ok).toBe(true);
    expect(await manager.open("jnk_c_secret")).toEqual({
      ok: false,
      reason: "session_limit",
    });
    expect(created).toBe(2);
  });

  it("enforces a per-token cap independently of the global cap", async () => {
    const manager = makeManager({ maxSessions: 5, maxSessionsPerToken: 1 });
    expect((await manager.open("jnk_alpha_secret")).ok).toBe(true);
    expect(await manager.open("jnk_alpha_secret")).toEqual({
      ok: false,
      reason: "token_limit",
    });
    expect((await manager.open("jnk_beta_secret")).ok).toBe(true);
  });

  it("expires idle sessions but never one with a request in flight", async () => {
    let now = 1_000;
    const manager = makeManager({
      idleMs: 100,
      now: () => now,
    });
    const session = opened(await manager.open("jnk_alpha_secret"));
    manager.begin(session);
    now += 500;
    expect(await manager.sweep()).toBe(0);
    manager.end(session);
    now += 101;
    expect(await manager.sweep()).toBe(1);
    expect(manager.stats()).toMatchObject({ sessions: 0, pending: 0 });
  });

  it("drains active requests before closing their sessions", async () => {
    const manager = makeManager();
    const active = opened(await manager.open("jnk_active_secret"));
    const idle = opened(await manager.open("jnk_idle_secret"));
    manager.begin(active);
    expect(manager.activeRequestCount()).toBe(1);
    await manager.closeIdle("shutdown_idle");
    expect(active.closed).toBe(false);
    expect(idle.closed).toBe(true);
    manager.end(active);
    expect(manager.activeRequestCount()).toBe(0);
    await manager.closeAll("shutdown");
    expect(active.closed).toBe(true);
  });

  it("closes every pending and live session on shutdown", async () => {
    const manager = makeManager();
    const first = opened(await manager.open("jnk_a_secret"));
    const second = opened(await manager.open("jnk_b_secret"));
    expect(manager.stats()).toMatchObject({ pending: 2 });
    await manager.closeAll("test_shutdown");
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
    expect(manager.stats()).toMatchObject({ sessions: 0, pending: 0 });
    expect(await manager.open("jnk_c_secret")).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("uses a stable, opaque fingerprint", () => {
    const first = fingerprintToken("jnk_same_secret");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(fingerprintToken("jnk_same_secret"));
    expect(first).not.toBe(fingerprintToken("jnk_other_secret"));
  });
});
