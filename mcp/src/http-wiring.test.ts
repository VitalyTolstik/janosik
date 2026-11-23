import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Wiring checks for the container/CI side of the gateway. They are plain file
 * assertions (no Docker daemon in unit tests) and fail if the separate service
 * loses its profile, port, healthcheck or token-free environment.
 */

const read = (relative: string) =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

describe("MCP gateway container wiring", () => {
  it("ships a separate Dockerfile and entry point", () => {
    const dockerfile = read("mcp/Dockerfile");
    expect(dockerfile).toContain("npm run build -w mcp");
    expect(dockerfile).toContain("COPY --from=build /app/mcp/dist ./mcp/dist");
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('CMD ["node", "/app/mcp/dist/http.js"]');
    expect(dockerfile).not.toMatch(/dist\/index\.js/);
  });

  it("runs the gateway as an optional compose service without a shared token", () => {
    const compose = read("docker-compose.yml");
    const start = compose.indexOf("\n  mcp:\n");
    const end = compose.indexOf("\n  postgres:\n");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = compose.slice(start, end);
    expect(block).toContain('profiles: ["mcp"]');
    expect(block).toContain("JANOSIK_URL: http://app:3000");
    expect(block).toContain("JANOSIK_MCP_HTTP_HOST: 0.0.0.0");
    expect(block).toContain('JANOSIK_MCP_HTTP_PORT: "8080"');
    expect(block).toContain("JANOSIK_MCP_HTTP_MAX_SESSIONS");
    expect(block).toContain("JANOSIK_MCP_HTTP_SESSION_IDLE_MS");
    expect(block).toContain("/ready");
    expect(block).not.toMatch(/JANOSIK_TOKEN\s*:/);
  });

  it("builds the gateway image in CI and publishes a manifest on release", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("file: mcp/Dockerfile");
    expect(workflow).toContain("janosik-mcp");
    expect(workflow).toContain("Build MCP gateway image (no push)");
    expect(workflow).toContain("Build and push MCP gateway image");
    expect(workflow).toContain("Publish MCP gateway manifest");
  });

  it("exposes the HTTP bin next to the stdio one", () => {
    const pkg = JSON.parse(read("mcp/package.json")) as {
      bin: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.bin).toMatchObject({
      "janosik-mcp": "dist/index.js",
      "janosik-mcp-http": "dist/http.js",
    });
    expect(pkg.scripts["start:http"]).toBe("node dist/http.js");
  });
});
