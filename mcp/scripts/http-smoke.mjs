#!/usr/bin/env node
/**
 * Container/HTTP smoke for the gateway: performs a real MCP initialize and
 * tools/list through the official Streamable HTTP client. Used by CI after
 * `docker run`; the mock API only needs `/api/v1/auth/me` for initialization.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? process.argv[2];
const token = process.env.MCP_TOKEN ?? "jnk_ci_smoke";
if (!url) throw new Error("Set MCP_URL or pass the /mcp URL as argv[2].");

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "gateway-smoke", version: "0.0.0" });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (!tools.some((tool) => tool.name === "janosik_list_boards")) {
    throw new Error("tools/list did not include janosik_list_boards");
  }
  console.log(`MCP handshake/tools/list OK (${tools.length} tools)`);
} finally {
  await client.close();
}
