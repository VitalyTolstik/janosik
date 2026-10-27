/**
 * Checklist tools: add/rename/delete a checklist on a card and add / tick /
 * rename / delete its items. Ids for new checklists and items are minted here.
 */

import { LIMITS } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { textOnly } from "../format.js";
import { newId } from "../ids.js";
import { boardIdSchema, cardIdSchema, idSchema } from "../schemas.js";
import { DESTRUCTIVE, WRITE, defineTool } from "./helpers.js";

const checklistIdSchema = idSchema.describe("Checklist id.");
const itemIdSchema = idSchema.describe("Checklist item id.");

export function registerChecklistTools(
  server: McpServer,
  client: JanosikClient,
) {
  defineTool(
    server,
    "janosik_add_checklist",
    {
      title: "Add a checklist",
      description:
        "Add a titled checklist to a card. Returns the checklist id.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        title: z
          .string()
          .min(1)
          .max(LIMITS.checklistTitle)
          .describe("Checklist title."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, title }) => {
      const newChecklistId = newId();
      await client.command(boardId, {
        type: "ADD_CHECKLIST",
        cardId,
        newChecklistId,
        title,
      });
      return textOnly(`Added checklist "${title}" — \`${newChecklistId}\`.`);
    },
  );

  defineTool(
    server,
    "janosik_rename_checklist",
    {
      title: "Rename a checklist",
      description: "Change a checklist's title.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
        title: z
          .string()
          .min(1)
          .max(LIMITS.checklistTitle)
          .describe("New title."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, title }) => {
      await client.command(boardId, {
        type: "RENAME_CHECKLIST",
        cardId,
        checklistId,
        title,
      });
      return textOnly(`Renamed checklist ${checklistId}.`);
    },
  );

  defineTool(
    server,
    "janosik_add_checklist_item",
    {
      title: "Add a checklist item",
      description: "Add an item (subtask) to a checklist. Returns the item id.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
        text: z
          .string()
          .min(1)
          .max(LIMITS.checklistItem)
          .describe("Item text."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, text }) => {
      const newItemId = newId();
      await client.command(boardId, {
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId,
        text,
      });
      return textOnly(`Added item "${text}" — \`${newItemId}\`.`);
    },
  );

  defineTool(
    server,
    "janosik_set_checklist_item_done",
    {
      title: "Tick a checklist item",
      description: "Check or uncheck a checklist item.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
        itemId: itemIdSchema,
        done: z.boolean().describe("true checks the item, false unchecks it."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, itemId, done }) => {
      await client.command(boardId, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId,
        checklistId,
        itemId,
        done,
      });
      return textOnly(`${done ? "Checked" : "Unchecked"} item ${itemId}.`);
    },
  );

  defineTool(
    server,
    "janosik_rename_checklist_item",
    {
      title: "Rename a checklist item",
      description: "Change a checklist item's text.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
        itemId: itemIdSchema,
        text: z
          .string()
          .min(1)
          .max(LIMITS.checklistItem)
          .describe("New item text."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, itemId, text }) => {
      await client.command(boardId, {
        type: "RENAME_CHECKLIST_ITEM",
        cardId,
        checklistId,
        itemId,
        text,
      });
      return textOnly(`Renamed item ${itemId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_checklist_item",
    {
      title: "Delete a checklist item",
      description: "Remove an item from a checklist.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
        itemId: itemIdSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, checklistId, itemId }) => {
      await client.command(boardId, {
        type: "DELETE_CHECKLIST_ITEM",
        cardId,
        checklistId,
        itemId,
      });
      return textOnly(`Deleted item ${itemId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_checklist",
    {
      title: "Delete a checklist",
      description: "Remove a checklist and its items from a card.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        checklistId: checklistIdSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, checklistId }) => {
      await client.command(boardId, {
        type: "DELETE_CHECKLIST",
        cardId,
        checklistId,
      });
      return textOnly(`Deleted checklist ${checklistId}.`);
    },
  );
}
