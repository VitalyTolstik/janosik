#!/usr/bin/env node
/**
 * Container/HTTP smoke for the gateway: performs a real MCP initialize and
 * tools/list over Streamable HTTP using only `fetch`. It deliberately has no
 * SDK import, so the Docker CI job can run it without `npm ci` on the host.
 */

const url = process.env.MCP_URL ?? process.argv[2];
const token = process.env.MCP_TOKEN ?? "jnk_ci_smoke";
if (!url) throw new Error("Set MCP_URL or pass the /mcp URL as argv[2].");

function parseMessages(text) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // A keepalive comment is not a JSON-RPC message.
    }
  }
  if (messages.length === 0) {
    try {
      messages.push(JSON.parse(text));
    } catch {
      // Let the caller report the malformed response.
    }
  }
  return messages;
}

const baseHeaders = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function post(body, sessionId) {
  const headers = { ...baseHeaders };
  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-06-18";
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, messages: parseMessages(text) };
}

const initialize = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gateway-smoke", version: "0.0.0" },
  },
});
const sessionId = initialize.response.headers.get("mcp-session-id");
if (initialize.response.status !== 200 || sessionId === null) {
  throw new Error(
    `initialize failed: ${initialize.response.status} ${initialize.text}`,
  );
}
const initialized = initialize.messages.find((message) => message.id === 1);
if (initialized?.result?.protocolVersion === undefined) {
  throw new Error(`initialize returned no protocolVersion: ${initialize.text}`);
}

const notification = await post(
  { jsonrpc: "2.0", method: "notifications/initialized" },
  sessionId,
);
if (notification.response.status !== 202) {
  throw new Error(
    `initialized notification: ${notification.response.status} ${notification.text}`,
  );
}

const list = await post(
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  sessionId,
);
const listed = list.messages.find((message) => message.id === 2);
const tools = listed?.result?.tools;
if (
  list.response.status !== 200 ||
  !Array.isArray(tools) ||
  !tools.some((tool) => tool.name === "janosik_list_boards")
) {
  throw new Error(`tools/list failed: ${list.response.status} ${list.text}`);
}

const deleted = await fetch(url, {
  method: "DELETE",
  headers: {
    authorization: `Bearer ${token}`,
    "mcp-session-id": sessionId,
    "mcp-protocol-version": "2025-06-18",
  },
});
if (deleted.status !== 200) {
  throw new Error(`DELETE session failed: ${deleted.status}`);
}

console.log(`MCP handshake/tools/list OK (${tools.length} tools)`);
