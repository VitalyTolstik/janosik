import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { isEntryPoint } from "./http.js";

const require = createRequire(import.meta.url);

describe("stdio entry point", () => {
  it("keeps the HTTP entry side-effect free when imported", () => {
    expect(isEntryPoint(undefined)).toBe(false);
    expect(
      isEntryPoint(fileURLToPath(new URL("./index.ts", import.meta.url))),
    ).toBe(false);
    expect(
      isEntryPoint(fileURLToPath(new URL("./http.ts", import.meta.url))),
    ).toBe(true);
  });

  it("still starts the desktop transport and registers the catalog", async () => {
    const tsxCli = path.join(
      path.dirname(require.resolve("tsx/package.json")),
      "dist",
      "cli.mjs",
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, fileURLToPath(new URL("./index.ts", import.meta.url))],
      env: {
        ...process.env,
        JANOSIK_URL: "http://127.0.0.1:1",
        JANOSIK_TOKEN: "jnk_stdio_regression",
        JANOSIK_MCP_TOOLSETS: "default",
      } as Record<string, string>,
    });
    const client = new Client({ name: "stdio-regression", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("janosik_list_boards");
      expect(names).toContain("janosik_create_card");
      expect(names.length).toBeGreaterThan(50);
      expect(client.getInstructions()).toContain("JANOSIK_TOKEN");
      expect(client.getInstructions()).not.toContain("Authorization: Bearer");
    } finally {
      await client.close();
    }
  }, 30_000);
});
