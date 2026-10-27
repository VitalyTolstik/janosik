/**
 * Member tools: list a board's members, invite by email, change a role or a
 * VIEWER expiry, and remove a member. Management needs the ADMIN role; a
 * time-limited VIEWER carries an `expiresAt`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import { renderMembers } from "../render.js";
import {
  boardIdSchema,
  responseFormatSchema,
  roleSchema,
  idSchema,
} from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

export function registerMemberTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_list_members",
    {
      title: "List board members",
      description:
        "List a board's members with their roles and user ids — the ids used " +
        "by janosik_set_card_assignee and janosik_update_member.",
      inputSchema: {
        boardId: boardIdSchema,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, response_format }) => {
      const members = await client.listMembers(boardId);
      return respond(response_format, { members }, renderMembers(members));
    },
  );

  defineTool(
    server,
    "janosik_invite_member",
    {
      title: "Invite a member",
      description:
        "Invite a person to the board by email (ADMIN only). The invitee " +
        "accepts from their notifications before gaining access.",
      inputSchema: {
        boardId: boardIdSchema,
        email: z.string().email().describe("Invitee email address."),
        role: roleSchema,
        expiresAt: z
          .string()
          .optional()
          .describe("ISO-8601 expiry, only meaningful for a VIEWER."),
      },
      annotations: WRITE,
    },
    async ({ boardId, email, role, expiresAt }) => {
      // The server answers the same way whether or not the address has an
      // account (so an invite cannot probe for accounts): no user id here.
      await client.inviteMember(boardId, {
        email,
        role,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      return textOnly(
        `Invited ${email} as ${role}. If they have a Janosik account, they ` +
          "will see the invitation and gain access once they accept.",
      );
    },
  );

  defineTool(
    server,
    "janosik_update_member",
    {
      title: "Update a member",
      description:
        "Change a member's role and/or a VIEWER's expiry (ADMIN only). Pass " +
        "expiresAt=null to clear an expiry; omit it to leave it unchanged.",
      inputSchema: {
        boardId: boardIdSchema,
        userId: idSchema.describe("Member user id."),
        role: roleSchema.optional(),
        expiresAt: z
          .string()
          .nullable()
          .optional()
          .describe("ISO-8601 expiry, or null to clear it."),
      },
      annotations: WRITE,
    },
    async ({ boardId, userId, role, expiresAt }) => {
      const member = await client.updateMember(boardId, userId, {
        ...(role !== undefined ? { role } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      return textOnly(`Updated member ${userId} — now ${member.role}.`);
    },
  );

  defineTool(
    server,
    "janosik_remove_member",
    {
      title: "Remove a member",
      description:
        "Remove a member from the board (ADMIN only). The last ADMIN cannot " +
        "be removed.",
      inputSchema: {
        boardId: boardIdSchema,
        userId: idSchema.describe("Member user id."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, userId }) => {
      await client.removeMember(boardId, userId);
      return textOnly(`Removed member ${userId} from board ${boardId}.`);
    },
  );
}
