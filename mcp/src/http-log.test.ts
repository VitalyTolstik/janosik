import { describe, expect, it } from "vitest";

import { createBufferLogger, redactSecrets } from "./http-log.js";

describe("gateway logging", () => {
  it("redacts bearer credentials and personal keys from arbitrary text", () => {
    expect(redactSecrets("Authorization: Bearer jnk_live_secret")).toBe(
      "Authorization: [redacted]",
    );
    expect(redactSecrets("key jnk_abc.def_123 leaked")).toBe(
      "key [redacted] leaked",
    );
    expect(redactSecrets("nothing sensitive")).toBe("nothing sensitive");
  });

  it("writes one JSON object per line and applies the level threshold", () => {
    const { logger, lines } = createBufferLogger({
      level: "warn",
      now: () => new Date("2026-11-23T00:00:00.000Z"),
    });
    logger.debug("hidden");
    logger.info("also_hidden");
    logger.warn("auth_failed", {
      requestId: "req-1",
      reason: "malformed",
      error: "Authorization: Bearer jnk_secret",
    });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({
      time: "2026-11-23T00:00:00.000Z",
      level: "warn",
      event: "auth_failed",
      requestId: "req-1",
      reason: "malformed",
      error: "Authorization: [redacted]",
    });
  });

  it("does not throw on circular or deep field bags", () => {
    const { logger, lines } = createBufferLogger();
    const circular: Record<string, unknown> = { token: "jnk_secret" };
    circular.self = circular;
    logger.info("circular", circular);
    expect(lines[0]).not.toContain("jnk_secret");
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
