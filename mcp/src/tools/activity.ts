/**
 * Activity tools: the merged command + activity feed of a board or a single
 * card, newest first, with "from → to" diffs where a command recorded them.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { JanosikClient } from "../client.js";
import { respond } from "../format.js";
import { renderActivity } from "../render.js";
import {
  boardIdSchema,
  cardIdSchema,
  pageSchema,
  responseFormatSchema,
} from "../schemas.js";
import { READ, defineTool } from "./helpers.js";

export function registerActivityTools(
  server: McpServer,
  client: JanosikClient,
) {
  defineTool(
    server,
    "janosik_board_activity",
    {
      title: "Board activity",
      description:
        "Read a board's activity feed — who changed what, when — newest " +
        "first. Page with the returned next_cursor.",
      inputSchema: {
        boardId: boardIdSchema,
        ...pageSchema.shape,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, cursor, limit, response_format }) => {
      const page = await client.boardActivity(boardId, cursor, limit);
      return respond(
        response_format,
        { activity: page.items, next_cursor: page.nextCursor },
        renderActivity(page.items, page.nextCursor),
      );
    },
  );

  defineTool(
    server,
    "janosik_card_activity",
    {
      title: "Card activity",
      description:
        "Read one card's history — field changes, moves, comments — newest " +
        "first. Page with the returned next_cursor.",
      inputSchema: {
        cardId: cardIdSchema,
        ...pageSchema.shape,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ cardId, cursor, limit, response_format }) => {
      const page = await client.cardActivity(cardId, cursor, limit);
      return respond(
        response_format,
        { activity: page.items, next_cursor: page.nextCursor },
        renderActivity(page.items, page.nextCursor),
      );
    },
  );
}
