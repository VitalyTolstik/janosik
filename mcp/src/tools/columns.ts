/**
 * Column tools: add, rename, reorder, duplicate, sort, set a WIP limit, clear
 * (archive every card) and delete. Each maps to one command-log action.
 */

import { COVER_COLORS, COVER_GRADIENTS, LIMITS } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { errorResult, textOnly } from "../format.js";
import { newId, stableCommandId } from "../ids.js";
import { findColumnIndex } from "../locate.js";
import {
  boardIdSchema,
  columnIdSchema,
  expectedVersionSchema,
} from "../schemas.js";
import { DESTRUCTIVE, WRITE, defineTool } from "./helpers.js";

/** The "not on this board" answer every column lookup shares. */
function columnNotFound(columnId: string, boardId: string) {
  return errorResult(
    `Error: column ${columnId} is not on board ${boardId}. Re-read the ` +
      "board with janosik_get_board for current ids.",
    { ok: false, code: "not_found", retryable: false, resource: "column" },
  );
}

const positionSchema = z
  .number()
  .int()
  .min(0)
  .describe("Zero-based position among the board's columns.");

export function registerColumnTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_create_column",
    {
      title: "Create a column",
      description:
        "Add a column to a board. Columns hold the cards; the board allows a " +
        "bounded number of them.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema
          .optional()
          .describe(
            "Client id for the new column — a retry then " +
              "returns the first column instead of a duplicate.",
          ),
        title: z
          .string()
          .min(1)
          .max(LIMITS.columnTitle)
          .describe("Column title."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, title, expectedVersion }) => {
      const newColumnId = columnId ?? newId();
      await client.command(
        boardId,
        {
          type: "ADD_COLUMN",
          newColumnId,
          title,
        },
        {
          ifMatch: expectedVersion,
          ...(columnId
            ? { commandId: stableCommandId(columnId, "create") }
            : {}),
        },
      );
      return textOnly(`Created column "${title}" — \`${newColumnId}\`.`, {
        resourceId: newColumnId,
      });
    },
  );

  defineTool(
    server,
    "janosik_rename_column",
    {
      title: "Rename a column",
      description: "Change a column's title.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        title: z
          .string()
          .min(1)
          .max(LIMITS.columnTitle)
          .describe("New column title."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, title, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "RENAME_COLUMN", columnId, title },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Renamed column ${columnId} to "${title}".`);
    },
  );

  defineTool(
    server,
    "janosik_move_column",
    {
      title: "Move a column",
      description:
        "Reorder a column on the board by moving it to a new zero-based " +
        "position. Use janosik_get_board to see the current order.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        position: positionSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, position, expectedVersion }) => {
      // Indexes come from the read; `ifMatch` refuses them if the board
      // changed in between (and the read is retried).
      const toIndex = await client.commandOnFreshBoard(
        boardId,
        (board) => {
          const fromIndex = findColumnIndex(board, columnId);
          if (fromIndex === -1) return null;
          const target = Math.min(position, board.columns.length - 1);
          return {
            action: {
              type: "MOVE_COLUMN",
              columnId,
              fromIndex,
              toIndex: target,
            },
            result: target,
          };
        },
        3,
        expectedVersion,
      );
      if (toIndex === null) return columnNotFound(columnId, boardId);
      return textOnly(`Moved column ${columnId} to position ${toIndex}.`);
    },
  );

  defineTool(
    server,
    "janosik_duplicate_column",
    {
      title: "Duplicate a column",
      description:
        "Copy a column and every card in it, placing the copy immediately to " +
        "the right of the original.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        title: z
          .string()
          .max(LIMITS.columnTitle)
          .optional()
          .describe("Title for the copy (defaults to the source title)."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, title, expectedVersion }) => {
      // One fresh id per source card: the count must match the column as the
      // server sees it, so the read is pinned with `ifMatch`.
      const copy = await client.commandOnFreshBoard(
        boardId,
        (board) => {
          const source = board.columns.find((column) => column.id === columnId);
          if (!source) return null;
          const newColumnId = newId();
          return {
            action: {
              type: "DUPLICATE_COLUMN",
              columnId,
              newColumnId,
              newCardIds: source.cardIds.map(() => newId()),
              ...(title !== undefined ? { title } : {}),
            },
            result: { newColumnId, source },
          };
        },
        3,
        expectedVersion,
      );
      if (copy === null) return columnNotFound(columnId, boardId);
      return textOnly(
        `Duplicated column "${copy.source.title}" (${copy.source.cardIds.length} card(s)) — \`${copy.newColumnId}\`.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_sort_column",
    {
      title: "Sort a column",
      description:
        "Sort a column's cards by a criterion. This replaces the current " +
        "manual order; a later drag changes only the dragged card's place.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        sortBy: z.enum(["createdAt", "dueDate", "title"]).describe("Sort key."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, sortBy, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "SORT_COLUMN", columnId, sortBy },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Sorted column ${columnId} by ${sortBy}.`);
    },
  );

  defineTool(
    server,
    "janosik_set_column_wip_limit",
    {
      title: "Set a column WIP limit",
      description:
        "Set or clear a column's work-in-progress limit. Pass a number to cap " +
        "the column, or omit it to remove the cap.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        wipLimit: z
          .number()
          .int()
          .min(1)
          .max(99)
          .optional()
          .describe("Max cards allowed, or omit to remove the limit."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, wipLimit, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId,
          ...(wipLimit !== undefined ? { wipLimit } : {}),
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(
        wipLimit !== undefined
          ? `Set WIP limit ${wipLimit} on column ${columnId}.`
          : `Removed the WIP limit on column ${columnId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_set_column_accent",
    {
      title: "Set a column accent",
      description:
        "Paint a column accent using the card-cover palette. The board's " +
        "column style decides how the accent is rendered. Omit `accent` to " +
        "clear it.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        accent: z
          .discriminatedUnion("type", [
            z.object({
              type: z.literal("color"),
              value: z.enum(COVER_COLORS),
            }),
            z.object({
              type: z.literal("gradient"),
              value: z.enum(COVER_GRADIENTS),
            }),
          ])
          .optional()
          .describe("Color/gradient pair, or omit to remove the accent."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, columnId, accent, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_COLUMN_ACCENT",
          columnId,
          ...(accent !== undefined ? { accent } : {}),
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(
        accent !== undefined
          ? `Set ${accent.type} accent ${accent.value} on column ${columnId}.`
          : `Removed the accent on column ${columnId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_clear_column",
    {
      title: "Clear a column",
      description:
        "Archive every card in a column in one command (a common way " +
        "to empty a 'Done' column without deleting the cards). Restore " +
        "individual cards with janosik_unarchive_card; MCP does not expose undo.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, columnId, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "ARCHIVE_COLUMN_CARDS",
          columnId,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Archived every card in column ${columnId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_column",
    {
      title: "Delete a column",
      description:
        "Remove a column and its cards. To keep the cards, archive them " +
        "with janosik_clear_column before deleting the empty column. Use " +
        "deletion when removing the column is specifically intended.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, columnId, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "DELETE_COLUMN", columnId },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Deleted column ${columnId}.`);
    },
  );
}
