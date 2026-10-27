/**
 * Share-link tools: mint, list, edit, refresh and revoke the public
 * read-only links of a board (ADMIN only). A `live` link follows the board;
 * a `snapshot` link is a frozen copy that survives the board being deleted.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SHARE_LIMITS } from "@janosik/shared";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import { renderShares } from "../render.js";
import { boardIdSchema, responseFormatSchema, idSchema } from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

/** Ten years: a longer expiry is "never" in practice, and stays a valid date. */
const MAX_SHARE_HOURS = 24 * 365 * 10;

/**
 * The human-facing link for a share token. The app's route is `/s/:token`,
 * served under the app base (`""` at the root, `/app` when the marketing site
 * owns the root), so the base is appended too.
 */
function shareUrl(baseUrl: string, appBase: string, token: string): string {
  return `${baseUrl}${appBase}/s/${token}`;
}

export function registerShareTools(
  server: McpServer,
  client: JanosikClient,
  baseUrl: string,
  appBase: string,
) {
  defineTool(
    server,
    "janosik_list_shares",
    {
      title: "List share links",
      description:
        "List a board's public read-only links with their mode, status and " +
        "view counts (ADMIN only).",
      inputSchema: {
        boardId: boardIdSchema,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, response_format }) => {
      const shares = await client.listShares(boardId);
      return respond(
        response_format,
        {
          shares: shares.map((share) => ({
            ...share,
            url: shareUrl(baseUrl, appBase, share.token),
          })),
        },
        renderShares(shares),
      );
    },
  );

  defineTool(
    server,
    "janosik_create_share",
    {
      title: "Create a share link",
      description:
        "Create a public read-only link to a board (ADMIN only). Use " +
        "'snapshot' for a frozen copy, 'live' to follow the board. Returns " +
        "the shareable URL.",
      inputSchema: {
        boardId: boardIdSchema,
        mode: z
          .enum(["live", "snapshot"])
          .describe("'live' follows the board; 'snapshot' is a frozen copy."),
        title: z
          .string()
          .max(SHARE_LIMITS.titleMax)
          .optional()
          .describe("Owner-side label."),
        includeComments: z
          .boolean()
          .optional()
          .describe("Show comments on the public view."),
        includeAttachments: z
          .boolean()
          .optional()
          .describe("Allow downloading attachments on the public view."),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(MAX_SHARE_HOURS)
          .optional()
          .describe("Expire the link after this many hours (default: never)."),
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      mode,
      title,
      includeComments,
      includeAttachments,
      expiresInHours,
    }) => {
      const share = await client.createShare(boardId, {
        mode,
        ...(title !== undefined ? { title } : {}),
        ...(includeComments !== undefined ? { includeComments } : {}),
        ...(includeAttachments !== undefined ? { includeAttachments } : {}),
        ...(expiresInHours !== undefined
          ? {
              expiresAt: new Date(
                Date.now() + expiresInHours * 3_600_000,
              ).toISOString(),
            }
          : {}),
      });
      return textOnly(
        `Created a ${mode} share link: ${shareUrl(baseUrl, appBase, share.token)}`,
      );
    },
  );

  defineTool(
    server,
    "janosik_update_share",
    {
      title: "Update a share link",
      description:
        "Change a share link's label and visibility flags, or clear its " +
        "expiry (ADMIN only).",
      inputSchema: {
        boardId: boardIdSchema,
        shareId: idSchema.describe("Share id."),
        title: z
          .string()
          .max(SHARE_LIMITS.titleMax)
          .nullable()
          .optional()
          .describe("New label."),
        includeComments: z.boolean().optional(),
        includeAttachments: z.boolean().optional(),
        clearExpiry: z
          .boolean()
          .optional()
          .describe("true removes any expiry, making the link permanent."),
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      shareId,
      title,
      includeComments,
      includeAttachments,
      clearExpiry,
    }) => {
      await client.updateShare(boardId, shareId, {
        ...(title !== undefined ? { title } : {}),
        ...(includeComments !== undefined ? { includeComments } : {}),
        ...(includeAttachments !== undefined ? { includeAttachments } : {}),
        ...(clearExpiry ? { expiresAt: null } : {}),
      });
      return textOnly(`Updated share ${shareId}.`);
    },
  );

  defineTool(
    server,
    "janosik_refresh_share",
    {
      title: "Refresh a snapshot share",
      description:
        "Re-capture a snapshot share from the board's current content " +
        "(ADMIN only). No effect on a live link.",
      inputSchema: {
        boardId: boardIdSchema,
        shareId: idSchema.describe("Share id."),
      },
      annotations: WRITE,
    },
    async ({ boardId, shareId }) => {
      await client.refreshShare(boardId, shareId);
      return textOnly(`Refreshed snapshot share ${shareId}.`);
    },
  );

  defineTool(
    server,
    "janosik_revoke_share",
    {
      title: "Revoke a share link",
      description:
        "Revoke a public link so it stops working (ADMIN only). Destructive.",
      inputSchema: {
        boardId: boardIdSchema,
        shareId: idSchema.describe("Share id."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, shareId }) => {
      await client.revokeShare(boardId, shareId);
      return textOnly(`Revoked share ${shareId}.`);
    },
  );
}
