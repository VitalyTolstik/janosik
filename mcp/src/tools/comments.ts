/**
 * Comment tools: list (cursor-paginated), add and delete. Comments are plain
 * markdown text and live outside the command log, so they are not undoable —
 * deleting removes the comment for good.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIMITS } from "@janosik/shared";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import { renderComments } from "../render.js";
import {
  cardIdSchema,
  pageSchema,
  responseFormatSchema,
  idSchema,
} from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

export function registerCommentTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_list_comments",
    {
      title: "List card comments",
      description:
        "List a card's comments, newest first. Page with the returned " +
        "next_cursor.",
      inputSchema: {
        cardId: cardIdSchema,
        ...pageSchema.shape,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ cardId, cursor, limit, response_format }) => {
      const page = await client.listComments(cardId, cursor, limit);
      return respond(
        response_format,
        { comments: page.items, next_cursor: page.nextCursor },
        renderComments(page.items, page.nextCursor),
      );
    },
  );

  defineTool(
    server,
    "janosik_add_comment",
    {
      title: "Add a comment",
      description: "Post a comment on a card.",
      inputSchema: {
        cardId: cardIdSchema,
        text: z
          .string()
          .min(1)
          .max(LIMITS.comment)
          .describe("Comment text (markdown)."),
      },
      annotations: WRITE,
    },
    async ({ cardId, text }) => {
      const comment = await client.addComment(cardId, text);
      return textOnly(`Added comment \`${comment.id}\` on card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_comment",
    {
      title: "Delete a comment",
      description:
        "Delete a comment (only the author may delete their own comment).",
      inputSchema: {
        commentId: idSchema.describe("Comment id."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ commentId }) => {
      await client.deleteComment(commentId);
      return textOnly(`Deleted comment ${commentId}.`);
    },
  );
}
