/**
 * Account tools for the authenticated user: who am I and update my profile.
 *
 * API keys are deliberately absent: the server refuses key management to an
 * API key (`403 pat_forbidden`), so a prompt-injected agent can never mint
 * itself a fresh key that would outlive the revocation of its own.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { DISPLAY_NAME_MAX, USER_AVATAR_COLORS } from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { formatTimestamp, respond, textOnly } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { READ, WRITE, defineTool } from "./helpers.js";

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
      const user = await client.whoami();
      return respond(
        response_format,
        { user },
        `# ${user.displayName ?? user.email}\n\n- email: ${user.email}\n- id: \`${user.id}\`\n- member since: ${formatTimestamp(user.createdAt)}`,
      );
    },
  );

  defineTool(
    server,
    "janosik_update_profile",
    {
      title: "Update my profile",
      description:
        "Change the authenticated user's display name and/or avatar colour.",
      inputSchema: {
        displayName: z
          .string()
          .max(DISPLAY_NAME_MAX)
          .nullable()
          .optional()
          .describe("New display name, or null to clear it."),
        avatarColor: z
          .enum(USER_AVATAR_COLORS)
          .nullable()
          .optional()
          .describe("Avatar palette key, or null for the default."),
      },
      annotations: WRITE,
    },
    async ({ displayName, avatarColor }) => {
      const user = await client.updateProfile({
        ...(displayName !== undefined ? { displayName } : {}),
        ...(avatarColor !== undefined ? { avatarColor } : {}),
      });
      return textOnly(`Updated profile for ${user.email}.`);
    },
  );
}
