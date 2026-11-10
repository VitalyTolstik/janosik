import { describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  DEFAULT_TOOLSETS,
  TOOLSETS,
  loadConfig,
} from "./config.js";

describe("loadConfig", () => {
  it("reads JANOSIK_URL and JANOSIK_TOKEN from the environment", () => {
    const config = loadConfig([], {
      JANOSIK_URL: "https://boards.example.com/",
      JANOSIK_TOKEN: "jnk_abc",
    });
    expect(config).toEqual({
      url: "https://boards.example.com",
      token: "jnk_abc",
      appBase: "",
      allowFs: false,
      fsRoot: null,
      toolsets: new Set(DEFAULT_TOOLSETS),
      readOnly: false,
    });
  });

  it("lets flags override the environment", () => {
    const config = loadConfig(
      ["--url", "http://localhost:3000", "--token", "t"],
      {
        JANOSIK_URL: "http://other",
        JANOSIK_TOKEN: "z",
      },
    );
    expect(config).toMatchObject({ url: "http://localhost:3000", token: "t" });
  });

  it("accepts --flag=value form", () => {
    const config = loadConfig(["--url=http://a", "--token=jnk_x"], {});
    expect(config).toMatchObject({ url: "http://a", token: "jnk_x" });
  });

  it("rejects a URL with a path or query instead of building broken API paths", () => {
    expect(() =>
      loadConfig(["--url=http://a.test/path?x=1", "--token=jnk_x"], {}),
    ).toThrow(/origin without a path/);
  });

  it("normalises the app base and reads the fs options", () => {
    const config = loadConfig([], {
      JANOSIK_URL: "http://a",
      JANOSIK_TOKEN: "t",
      JANOSIK_APP_BASE: "/app/",
      JANOSIK_MCP_FS_ROOT: "/tmp/sandbox",
    });
    expect(config.appBase).toBe("/app");
    // A root only constrains access; it does not opt in to filesystem tools.
    expect(config.allowFs).toBe(false);
    expect(config.fsRoot).toBe("/tmp/sandbox");
  });

  it("enables fs access from the boolean env", () => {
    const config = loadConfig([], {
      JANOSIK_URL: "http://a",
      JANOSIK_TOKEN: "t",
      JANOSIK_MCP_ALLOW_FS: "1",
    });
    expect(config.allowFs).toBe(true);
    expect(config.fsRoot).toBeNull();
  });

  it("names the missing variable in a ConfigError", () => {
    expect(() => loadConfig([], {})).toThrow(ConfigError);
    expect(() => loadConfig([], { JANOSIK_URL: "http://a" })).toThrow(
      /JANOSIK_TOKEN/,
    );
  });

  it("rejects an unknown flag and a missing value", () => {
    expect(() => loadConfig(["--URL=http://a"], {})).toThrow(ConfigError);
    expect(() =>
      loadConfig(["--url", "--token", "t"], { JANOSIK_TOKEN: "t" }),
    ).toThrow(/Missing value for --url/);
  });

  it("keeps the account-level toolsets opt-in", () => {
    const env = { JANOSIK_URL: "http://x", JANOSIK_TOKEN: "t" };
    expect(loadConfig([], env).toolsets.has("account")).toBe(false);
    const extended = loadConfig([], {
      ...env,
      JANOSIK_MCP_TOOLSETS: "default,members",
    }).toolsets;
    expect(extended.has("members")).toBe(true);
    expect(extended.has("cards")).toBe(true);
    expect(loadConfig(["--toolsets", "all"], env).toolsets.size).toBe(
      TOOLSETS.length,
    );
  });

  it("accepts the removed invitations toolset as a no-op with a warning", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const config = loadConfig([], {
        JANOSIK_URL: "http://x",
        JANOSIK_TOKEN: "t",
        JANOSIK_MCP_TOOLSETS: "default,invitations",
      });
      expect(config.toolsets.has("cards")).toBe(true);
      expect(config.toolsets.has("members")).toBe(false);
      expect(write.mock.calls.flat().join("")).toMatch(/invitations.*removed/i);
    } finally {
      write.mockRestore();
    }
  });

  it("rejects an unknown toolset name", () => {
    expect(() =>
      loadConfig(["--toolsets", "cards,acount"], {
        JANOSIK_URL: "http://x",
        JANOSIK_TOKEN: "t",
      }),
    ).toThrow(ConfigError);
  });

  it("reads the read-only switch", () => {
    const env = { JANOSIK_URL: "http://x", JANOSIK_TOKEN: "t" };
    expect(loadConfig(["--read-only"], env).readOnly).toBe(true);
    expect(loadConfig([], { ...env, JANOSIK_MCP_READONLY: "1" }).readOnly).toBe(
      true,
    );
  });
});
