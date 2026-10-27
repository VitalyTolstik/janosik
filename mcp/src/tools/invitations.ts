/**
 * Invitation tools: the pending board invitations addressed to the
 * authenticated user, and accepting or declining one.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import { formatTimestamp } from "../format.js";
import { responseFormatSchema, idSchema } from "../schemas.js";
import { READ, WRITE, defineTool } from "./helpers.js";

export function registerInvitationTools(
  server: McpServer,
  client: JanosikClient,
) {
  defineTool(
    server,
    "janosik_list_invitations",
    {
      title: "List my invitations",
      description:
        "List board invitations waiting for the authenticated user to accept " +
        "or decline.",
      inputSchema: { response_format: responseFormatSchema },
      annotations: READ,
    },
    async ({ response_format }) => {
      const invitations = await client.listInvitations();
      const markdown =
        invitations.length === 0
          ? "No pending invitations."
          : `# Invitations (${invitations.length})\n\n${invitations
              .map(
                (invite) =>
                  `- ${invite.boardTitle} as ${invite.role}` +
                  (invite.expiresAt
                    ? ` (expires ${formatTimestamp(invite.expiresAt)})`
                    : "") +
                  ` — \`${invite.id}\``,
              )
              .join("\n")}`;
      return respond(response_format, { invitations }, markdown);
    },
  );

  defineTool(
    server,
    "janosik_accept_invitation",
    {
      title: "Accept an invitation",
      description:
        "Accept a board invitation, gaining access at the offered role.",
      inputSchema: {
        invitationId: idSchema.describe("Invitation id."),
      },
      annotations: WRITE,
    },
    async ({ invitationId }) => {
      await client.acceptInvitation(invitationId);
      return textOnly(
        `Accepted invitation ${invitationId}. The board now appears in ` +
          "janosik_list_boards.",
      );
    },
  );

  defineTool(
    server,
    "janosik_decline_invitation",
    {
      title: "Decline an invitation",
      description: "Decline a board invitation.",
      inputSchema: {
        invitationId: idSchema.describe("Invitation id."),
      },
      annotations: WRITE,
    },
    async ({ invitationId }) => {
      await client.declineInvitation(invitationId);
      return textOnly(`Declined invitation ${invitationId}.`);
    },
  );
}
