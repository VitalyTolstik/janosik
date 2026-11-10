/**
 * Account tools for the authenticated user: who am I.
 *
 * API keys and profile writes are deliberately absent: the server refuses
 * account credentials and profile changes to an API key (`403 pat_forbidden`)
 * and MCP does not register the corresponding tools (TASK-166 D22). An agent
 * can read its identity/scope through `janosik_whoami`, but cannot widen it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { JanosikClient } from "../client.js";
import { formatTimestamp, respond } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { READ, defineTool } from "./helpers.js";

export function registerAccountTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_whoami",
    {
      title: "Who am I",
      description:
        "Return the authenticated user (the account the API token belongs to).",
      inputSchema: { response_format: responseFormatSchema },
      annotations: READ,
    },
    async ({ response_format }) => {
      const me = await client.whoami();
      const { token, session, server: serverInfo, ...user } = me;
      const server = serverInfo ?? { version: "0.0.0", apiVersion: "1" };
      const lines = [
        `# ${user.displayName ?? user.email}`,
        "",
        `- email: ${user.email}`,
        `- id: \`${user.id}\``,
        `- member since: ${formatTimestamp(user.createdAt)}`,
      ];
      if (token) {
        lines.push(
          "",
          "## API token",
          `- id: \`${token.id}\``,
          `- name: ${token.name}`,
          `- scope: ${token.effectiveTokenScope} (preset ${token.scopePreset})`,
          `- trusted CI: ${token.trustedCi ? "yes" : "no"}`,
          `- paused: ${token.paused ? "yes" : "no"}`,
        );
      }
      lines.push("", `Server ${server.version} (API ${server.apiVersion})`);
      return respond(
        response_format,
        { user, token, session, server },
        lines.join("\n"),
      );
    },
  );
}
