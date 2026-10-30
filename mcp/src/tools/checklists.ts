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
import {
  boardIdSchema,
  cardIdSchema,
  expectedVersionSchema,
  idSchema,
} from "../schemas.js";
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
        checklistId: idSchema
          .optional()
          .describe(
            "Client id for the new checklist (TASK-157, E14) — a retry then " +
              "returns the first checklist instead of a duplicate.",
          ),
        title: z
          .string()
          .min(1)
          .max(LIMITS.checklistTitle)
          .describe("Checklist title."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, title, expectedVersion }) => {
      const newChecklistId = checklistId ?? newId();
      await client.command(
        boardId,
        {
          type: "ADD_CHECKLIST",
          cardId,
          newChecklistId,
          title,
        },
        {
          ifMatch: expectedVersion,
          ...(checklistId ? { commandId: checklistId } : {}),
        },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, title, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "RENAME_CHECKLIST",
          cardId,
          checklistId,
          title,
        },
        { ifMatch: expectedVersion },
      );
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
        itemId: idSchema
          .optional()
          .describe(
            "Client id for the new item (TASK-157, E14) — a retry then " +
              "returns the first item instead of a duplicate.",
          ),
        text: z
          .string()
          .min(1)
          .max(LIMITS.checklistItem)
          .describe("Item text."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, itemId, text, expectedVersion }) => {
      const newItemId = itemId ?? newId();
      await client.command(
        boardId,
        {
          type: "ADD_CHECKLIST_ITEM",
          cardId,
          checklistId,
          newItemId,
          text,
        },
        { ifMatch: expectedVersion, ...(itemId ? { commandId: itemId } : {}) },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, itemId, done, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_CHECKLIST_ITEM_DONE",
          cardId,
          checklistId,
          itemId,
          done,
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, checklistId, itemId, text, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "RENAME_CHECKLIST_ITEM",
          cardId,
          checklistId,
          itemId,
          text,
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, checklistId, itemId, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "DELETE_CHECKLIST_ITEM",
          cardId,
          checklistId,
          itemId,
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, checklistId, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "DELETE_CHECKLIST",
          cardId,
          checklistId,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Deleted checklist ${checklistId}.`);
    },
  );
}
