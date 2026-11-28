import { EPIC_STATUSES, LIMITS } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { BatchCommandItem, JanosikClient } from "../client.js";
import {
  batchCommandFields,
  commandFields,
  errorResult,
  respond,
  textOnly,
} from "../format.js";
import { NoChangeError } from "../errors.js";
import { newId, stableCommandId, stableId } from "../ids.js";
import {
  approvalIdSchema,
  boardIdSchema,
  commandIdSchema,
  expectedVersionSchema,
  idSchema,
  responseFormatSchema,
} from "../schemas.js";
import { DESTRUCTIVE, WRITE, defineTool } from "./helpers.js";

const titleSchema = z.string().trim().min(1).max(LIMITS.epicTitle);
const descriptionSchema = z.string().max(LIMITS.epicDescription);
const dateSchema = z.union([
  z.string().date(),
  z.string().datetime({ offset: true }),
  z.number().int().min(-8.64e15).max(8.64e15),
]);

function date(value: z.infer<typeof dateSchema>): number {
  return typeof value === "string" ? Date.parse(value) : value;
}

export function registerEpicTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_create_epic",
    {
      title: "Create an epic",
      description:
        "Create a board-scoped epic and return its id. Assign cards with janosik_create_card or janosik_update_card.",
      inputSchema: {
        boardId: boardIdSchema,
        epicId: idSchema
          .optional()
          .describe("Client id for the new epic. Reuse it on retry."),
        title: titleSchema.describe("Epic title."),
        description: descriptionSchema
          .optional()
          .describe("Epic description (markdown)."),
        ownerId: idSchema
          .optional()
          .describe("User id of an accepted board member."),
        startDate: dateSchema
          .optional()
          .describe("Start date, ISO-8601 or Unix milliseconds."),
        dueDate: dateSchema
          .optional()
          .describe("Due date, ISO-8601 or Unix milliseconds."),
        commandId: commandIdSchema.optional(),
        expectedVersion: expectedVersionSchema,
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      epicId,
      title,
      description,
      ownerId,
      startDate,
      dueDate,
      commandId,
      expectedVersion,
      response_format,
    }) => {
      const id =
        epicId ?? (commandId ? stableId(`epic:${commandId}`) : newId());
      const response = await client.command(
        boardId,
        {
          type: "ADD_EPIC",
          epic: {
            id,
            title,
            color: "rose",
            status: "active",
            // The reducer supplies the actual position and command timestamps.
            position: 0,
            createdAt: 0,
            updatedAt: 0,
            ...(description !== undefined ? { description } : {}),
            ...(ownerId !== undefined ? { ownerId } : {}),
            ...(startDate !== undefined ? { startDate: date(startDate) } : {}),
            ...(dueDate !== undefined ? { dueDate: date(dueDate) } : {}),
          },
        },
        {
          ifMatch: expectedVersion,
          commandId:
            commandId ??
            (epicId ? stableCommandId(epicId, "create-epic") : undefined),
        },
      );
      return respond(
        response_format,
        { resourceId: id, ...commandFields(response) },
        `Created epic "${title}" — \`${id}\`.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_update_epic",
    {
      title: "Update an epic",
      description:
        "Edit an epic, complete it or reopen it. Completion leaves its cards in their current columns.",
      inputSchema: {
        boardId: boardIdSchema,
        epicId: idSchema.describe("Epic id from janosik_get_board."),
        title: titleSchema.optional().describe("New epic title."),
        description: descriptionSchema
          .nullable()
          .optional()
          .describe("New description. Null clears it."),
        ownerId: idSchema
          .nullable()
          .optional()
          .describe("Accepted board member user id. Null clears it."),
        startDate: dateSchema
          .nullable()
          .optional()
          .describe(
            "Start date, ISO-8601 or Unix milliseconds. Null clears it.",
          ),
        dueDate: dateSchema
          .nullable()
          .optional()
          .describe("Due date, ISO-8601 or Unix milliseconds. Null clears it."),
        status: z
          .enum(EPIC_STATUSES)
          .optional()
          .describe("Completed to finish the epic, active to reopen it."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      epicId,
      expectedVersion,
      status,
      startDate,
      dueDate,
      ...fields
    }) => {
      const patch = {
        ...fields,
        ...(startDate !== undefined
          ? { startDate: startDate === null ? null : date(startDate) }
          : {}),
        ...(dueDate !== undefined
          ? { dueDate: dueDate === null ? null : date(dueDate) }
          : {}),
      };
      const items: BatchCommandItem[] = [];
      if (Object.values(patch).some((value) => value !== undefined)) {
        items.push({ action: { type: "UPDATE_EPIC", epicId, ...patch } });
      }
      if (status !== undefined) {
        items.push({ action: { type: "SET_EPIC_STATUS", epicId, status } });
      }
      if (items.length === 0)
        return errorResult("Supply at least one epic field to update.");
      items[0].ifMatch = expectedVersion;
      const result = await client.commandBatch(boardId, items);
      if (
        result.results.every(
          ({ versions }) => Object.keys(versions).length === 0,
        )
      ) {
        throw new NoChangeError("UPDATE_EPIC");
      }
      return textOnly(`Updated epic ${epicId}.`, batchCommandFields(result));
    },
  );

  defineTool(
    server,
    "janosik_delete_epic",
    {
      title: "Delete an epic",
      description:
        "Soft-delete an epic and keep its cards in their columns. Requires an admin-scoped token and follows the board's destructive policy.",
      inputSchema: {
        boardId: boardIdSchema,
        epicId: idSchema.describe("Epic id from janosik_get_board."),
        commandId: commandIdSchema.optional(),
        expectedVersion: expectedVersionSchema,
        approvalId: approvalIdSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, epicId, commandId, expectedVersion, approvalId }) => {
      const response = await client.command(
        boardId,
        { type: "DELETE_EPIC", epicId },
        { ifMatch: expectedVersion, commandId, approvalId },
      );
      return textOnly(
        `Deleted epic ${epicId}. Its cards remain on the board.`,
        commandFields(response),
      );
    },
  );
}
