/**
 * Label tools: list, create, rename, recolour, delete, and attach/detach a
 * label on a card. A label is board-scoped; attaching is an absolute
 * on/off command, not a toggle, so two agents never race into the opposite
 * result.
 */

import { LIMITS } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import { newId } from "../ids.js";
import {
  boardIdSchema,
  cardIdSchema,
  labelColorSchema,
  responseFormatSchema,
  idSchema,
} from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

export function registerLabelTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_list_labels",
    {
      title: "List labels",
      description: "List the labels defined on a board.",
      inputSchema: {
        boardId: boardIdSchema,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, response_format }) => {
      const board = await client.getBoard(boardId);
      const markdown =
        board.labels.length === 0
          ? "No labels."
          : `# Labels (${board.labels.length})\n\n${board.labels
              .map(
                (label) => `- ${label.name} (${label.color}) — \`${label.id}\``,
              )
              .join("\n")}`;
      return respond(response_format, { labels: board.labels }, markdown);
    },
  );

  defineTool(
    server,
    "janosik_create_label",
    {
      title: "Create a label",
      description:
        "Create a board label with a name and colour. Returns its id.",
      inputSchema: {
        boardId: boardIdSchema,
        name: z.string().min(1).max(LIMITS.labelName).describe("Label name."),
        color: labelColorSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, name, color }) => {
      const id = newId();
      await client.command(boardId, {
        type: "ADD_LABEL",
        label: { id, name, color },
      });
      return textOnly(`Created label "${name}" (${color}) — \`${id}\`.`);
    },
  );

  defineTool(
    server,
    "janosik_rename_label",
    {
      title: "Rename a label",
      description: "Change a label's name everywhere it is used.",
      inputSchema: {
        boardId: boardIdSchema,
        labelId: idSchema.describe("Label id."),
        name: z.string().min(1).max(LIMITS.labelName).describe("New name."),
      },
      annotations: WRITE,
    },
    async ({ boardId, labelId, name }) => {
      await client.command(boardId, { type: "RENAME_LABEL", labelId, name });
      return textOnly(`Renamed label ${labelId} to "${name}".`);
    },
  );

  defineTool(
    server,
    "janosik_set_label_color",
    {
      title: "Set a label colour",
      description: "Change a label's colour.",
      inputSchema: {
        boardId: boardIdSchema,
        labelId: idSchema.describe("Label id."),
        color: labelColorSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, labelId, color }) => {
      await client.command(boardId, {
        type: "SET_LABEL_COLOR",
        labelId,
        color,
      });
      return textOnly(`Set label ${labelId} to ${color}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_label",
    {
      title: "Delete a label",
      description: "Delete a label and detach it from every card. Destructive.",
      inputSchema: {
        boardId: boardIdSchema,
        labelId: idSchema.describe("Label id."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, labelId }) => {
      await client.command(boardId, { type: "DELETE_LABEL", labelId });
      return textOnly(`Deleted label ${labelId}.`);
    },
  );

  defineTool(
    server,
    "janosik_set_card_label",
    {
      title: "Attach or detach a label",
      description:
        "Attach a label to a card (on=true) or detach it (on=false).",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        labelId: idSchema.describe("Label id."),
        on: z.boolean().describe("true attaches, false detaches."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, labelId, on }) => {
      await client.command(boardId, {
        type: "SET_CARD_LABEL",
        cardId,
        labelId,
        on,
      });
      return textOnly(
        `${on ? "Attached" : "Detached"} label ${labelId} ${on ? "to" : "from"} card ${cardId}.`,
      );
    },
  );
}
