import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The MCP Registry matches an npm package to its metadata by `mcpName`, and
 * the version it lists must be the one actually published. A silent drift
 * (a bumped `package.json` with a stale `server.json`, or a typo in the
 * registry name) would fail the publish *after* the npm upload, so the
 * invariant is checked here — cheaply, on every run.
 */
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  version: string;
  mcpName?: string;
  bin?: Record<string, string>;
  files?: string[];
};

const server = JSON.parse(
  readFileSync(new URL("../server.json", import.meta.url), "utf8"),
) as {
  name: string;
  version: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string;
    transport: { type: string };
  }>;
};

describe("MCP registry metadata", () => {
  it("declares a GitHub-namespaced mcpName matching server.json", () => {
    expect(pkg.mcpName).toBeDefined();
    expect(pkg.mcpName).toMatch(/^io\.github\.[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(server.name).toBe(pkg.mcpName);
  });

  it("keeps the package and server versions in lockstep", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]!.version).toBe(pkg.version);
  });

  it("points the registry at this npm package over stdio", () => {
    expect(server.packages[0]!.registryType).toBe("npm");
    expect(server.packages[0]!.identifier).toBe(pkg.name);
    expect(server.packages[0]!.transport.type).toBe("stdio");
  });

  it("ships a runnable bin and only the built files", () => {
    expect(pkg.bin).toEqual({ "janosik-mcp": "dist/index.js" });
    expect(pkg.files).toContain("dist");
  });
});
