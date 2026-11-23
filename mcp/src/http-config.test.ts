import { describe, expect, it } from "vitest";

import { ConfigError, DEFAULT_TOOLSETS } from "./config.js";
import { loadGatewayConfig } from "./http-config.js";

const baseEnv = { JANOSIK_URL: "https://boards.example.com/" };

describe("loadGatewayConfig", () => {
  it("needs an instance URL but deliberately ignores a shared token", () => {
    const loaded = loadGatewayConfig({
      ...baseEnv,
      JANOSIK_TOKEN: "jnk_shared_must_not_be_used",
    });
    expect(loaded.config.base).toMatchObject({
      url: "https://boards.example.com",
      token: "",
      appBase: "",
      readOnly: false,
    });
    expect(loaded.config.base.toolsets).toEqual(new Set(DEFAULT_TOOLSETS));
    expect(loaded.ignoredSharedToken).toBe(true);
    expect(loaded.config).toMatchObject({
      host: "127.0.0.1",
      port: 8080,
      path: "/mcp",
      maxSessions: 500,
      maxSessionsPerToken: 50,
      initRateLimitPerMinute: 600,
      tokenInitRateLimitPerMinute: 10,
      negativeCacheTtlMs: 60_000,
      negativeCacheMaxEntries: 1_000,
      authValidationAttempts: 2,
      authValidationMaxDelayMs: 1_000,
      sessionIdleMs: 300_000,
      sessionSweepMs: 30_000,
      maxBodyBytes: 16 * 1024 * 1024,
      readinessUrl: "https://boards.example.com/api/v1/health/ready",
      readinessCacheMs: 5_000,
      readinessTimeoutMs: 3_000,
      authValidateUrl: "https://boards.example.com/api/v1/auth/me",
      authValidateTimeoutMs: 3_000,
      sseKeepAliveMs: 15_000,
      trustProxy: false,
      logLevel: "info",
      shutdownGraceMs: 10_000,
      requestTimeoutMs: 60_000,
      headersTimeoutMs: 60_000,
    });
    expect(loaded.config.allowedOrigins.size).toBe(0);
  });

  it("parses every gateway knob without changing the stdio tool config", () => {
    const loaded = loadGatewayConfig({
      ...baseEnv,
      JANOSIK_APP_BASE: "/app/",
      JANOSIK_MCP_TOOLSETS: "default,account",
      JANOSIK_MCP_READONLY: "1",
      JANOSIK_MCP_HTTP_HOST: "0.0.0.0",
      JANOSIK_MCP_HTTP_PORT: "0",
      JANOSIK_MCP_HTTP_PATH: "/agents/mcp/",
      JANOSIK_MCP_HTTP_MAX_SESSIONS: "1000",
      JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN: "25",
      JANOSIK_MCP_HTTP_INIT_RATE_LIMIT: "300",
      JANOSIK_MCP_HTTP_INIT_RATE_LIMIT_PER_TOKEN: "5",
      JANOSIK_MCP_HTTP_NEGATIVE_CACHE_TTL_MS: "0",
      JANOSIK_MCP_HTTP_NEGATIVE_CACHE_MAX_ENTRIES: "50",
      JANOSIK_MCP_HTTP_AUTH_RETRY_ATTEMPTS: "3",
      JANOSIK_MCP_HTTP_AUTH_RETRY_MAX_DELAY_MS: "0",
      JANOSIK_MCP_HTTP_SESSION_IDLE_MS: "60000",
      JANOSIK_MCP_HTTP_SESSION_SWEEP_MS: "5000",
      JANOSIK_MCP_HTTP_MAX_BODY_BYTES: "1024",
      JANOSIK_MCP_HTTP_ALLOWED_ORIGINS:
        "https://app.example.com, http://localhost:5173/",
      JANOSIK_MCP_HTTP_READY_URL: "https://api.example.com/health/ready",
      JANOSIK_MCP_HTTP_READY_CACHE_MS: "0",
      JANOSIK_MCP_HTTP_READY_TIMEOUT_MS: "500",
      JANOSIK_MCP_HTTP_AUTH_URL: "https://api.example.com/auth/me",
      JANOSIK_MCP_HTTP_AUTH_TIMEOUT_MS: "400",
      JANOSIK_MCP_HTTP_SSE_KEEPALIVE_MS: "0",
      JANOSIK_MCP_HTTP_TRUST_PROXY: "true",
      JANOSIK_MCP_HTTP_LOG_LEVEL: "debug",
      JANOSIK_MCP_HTTP_SHUTDOWN_GRACE_MS: "2500",
      JANOSIK_MCP_HTTP_REQUEST_TIMEOUT_MS: "0",
      JANOSIK_MCP_HTTP_HEADERS_TIMEOUT_MS: "5000",
    });
    expect(loaded.ignoredSharedToken).toBe(false);
    expect(loaded.config.base.appBase).toBe("/app");
    expect(loaded.config.base.readOnly).toBe(true);
    expect(loaded.config.base.toolsets.has("account")).toBe(true);
    expect(loaded.config).toMatchObject({
      host: "0.0.0.0",
      port: 0,
      path: "/agents/mcp",
      maxSessions: 1000,
      maxSessionsPerToken: 25,
      initRateLimitPerMinute: 300,
      tokenInitRateLimitPerMinute: 5,
      negativeCacheTtlMs: 0,
      negativeCacheMaxEntries: 50,
      authValidationAttempts: 3,
      authValidationMaxDelayMs: 0,
      sessionIdleMs: 60_000,
      sessionSweepMs: 5_000,
      maxBodyBytes: 1024,
      readinessUrl: "https://api.example.com/health/ready",
      readinessCacheMs: 0,
      readinessTimeoutMs: 500,
      authValidateUrl: "https://api.example.com/auth/me",
      authValidateTimeoutMs: 400,
      sseKeepAliveMs: 0,
      trustProxy: true,
      logLevel: "debug",
      shutdownGraceMs: 2500,
      requestTimeoutMs: 0,
      headersTimeoutMs: 5000,
    });
    expect(loaded.config.allowedOrigins).toEqual(
      new Set(["https://app.example.com", "http://localhost:5173"]),
    );
  });

  it("allows an explicit wildcard origin", () => {
    const loaded = loadGatewayConfig({
      ...baseEnv,
      JANOSIK_MCP_HTTP_ALLOWED_ORIGINS: "*",
    });
    expect(loaded.config.allowedOrigins).toEqual(new Set(["*"]));
  });

  it("names the missing URL", () => {
    expect(() => loadGatewayConfig({})).toThrow(ConfigError);
    expect(() => loadGatewayConfig({})).toThrow(/JANOSIK_URL/);
  });

  it("rejects malformed numeric, path, origin and log settings", () => {
    const bad = (env: NodeJS.ProcessEnv) =>
      expect(() => loadGatewayConfig({ ...baseEnv, ...env })).toThrow(
        ConfigError,
      );
    bad({ JANOSIK_MCP_HTTP_PORT: "not-a-port" });
    bad({ JANOSIK_MCP_HTTP_PORT: "70000" });
    bad({ JANOSIK_MCP_HTTP_MAX_SESSIONS: "0" });
    bad({
      JANOSIK_MCP_HTTP_MAX_SESSIONS: "2",
      JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN: "3",
    });
    bad({ JANOSIK_MCP_HTTP_PATH: "mcp" });
    bad({ JANOSIK_MCP_HTTP_PATH: "/mcp?token=1" });
    bad({ JANOSIK_MCP_HTTP_PATH: "/health" });
    bad({ JANOSIK_MCP_HTTP_ALLOWED_ORIGINS: "https://a.example/path" });
    bad({ JANOSIK_MCP_HTTP_READY_URL: "ftp://a.example/ready" });
    bad({ JANOSIK_MCP_HTTP_AUTH_URL: "file:///etc/passwd" });
    bad({ JANOSIK_MCP_HTTP_SESSION_IDLE_MS: "2147483648" });
    bad({ JANOSIK_MCP_HTTP_READY_TIMEOUT_MS: "2147483648" });
    bad({ JANOSIK_MCP_HTTP_AUTH_RETRY_ATTEMPTS: "0" });
    bad({ JANOSIK_MCP_HTTP_AUTH_RETRY_ATTEMPTS: "6" });
    bad({ JANOSIK_MCP_HTTP_NEGATIVE_CACHE_MAX_ENTRIES: "0" });
    bad({ JANOSIK_MCP_HTTP_LOG_LEVEL: "verbose" });
    bad({ JANOSIK_MCP_HTTP_HOST: "has space" });
  });

  it("reports a --token flag as ignored shared state", () => {
    const loaded = loadGatewayConfig(baseEnv, ["--token", "jnk_flag"]);
    expect(loaded.ignoredSharedToken).toBe(true);
    expect(loaded.config.base.token).toBe("");
  });

  it("keeps the stdio loader's token requirement", async () => {
    const { loadConfig } = await import("./config.js");
    expect(() =>
      loadConfig([], { JANOSIK_URL: "https://boards.example.com" }),
    ).toThrow(/JANOSIK_TOKEN/);
  });
});
