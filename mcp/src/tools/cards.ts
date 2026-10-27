/**
 * Card tools: create (with optional fields applied in one call), read, update,
 * move, duplicate, archive/unarchive, delete, set priority / assignee / due
 * date / cover, and search. Every write is one or more command-log actions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LIMITS, type Board, type Card } from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { describeError } from "../errors.js";
import { errorResult, respond, textOnly } from "../format.js";
import { newId } from "../ids.js";
import { findCardLocation } from "../locate.js";
import { renderCard } from "../render.js";
import {
  boardIdSchema,
  cardIdSchema,
  columnIdSchema,
  coverSchema,
  idSchema,
  prioritySchema,
  responseFormatSchema,
} from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

/** Parse a due date into Unix ms, or `undefined` to clear it. */
function parseDueDate(
  value: string | number | null | undefined,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(
      `Invalid due date "${value}". Use an ISO-8601 string, e.g. 2026-11-01T09:00:00Z.`,
    );
  }
  return ms;
}

/**
 * Apply the optional card fields that ADD_CARD cannot carry, one command
 * each. Keeps `janosik_create_card` a single convenient call for agents while
 * every write still travels as a normal command. Inputs are validated by the
 * caller *before* the card exists, so a bad field cannot strand a half-made
 * card; a value that is already set (e.g. the default priority) is not an
 * error here.
 */
async function applyCardFields(
  client: JanosikClient,
  boardId: string,
  cardId: string,
  fields: {
    description?: string;
    priority?: z.infer<typeof prioritySchema>;
    assigneeId?: string;
    dueDate?: number;
  },
): Promise<void> {
  const quiet = { allowNoChange: true };
  if (fields.description !== undefined) {
    await client.command(
      boardId,
      { type: "UPDATE_CARD", cardId, description: fields.description },
      quiet,
    );
  }
  if (fields.priority !== undefined) {
    await client.command(
      boardId,
      { type: "SET_CARD_PRIORITY", cardId, priority: fields.priority },
      quiet,
    );
  }
  if (fields.assigneeId !== undefined) {
    await client.command(
      boardId,
      { type: "SET_CARD_ASSIGN", cardId, assigneeId: fields.assigneeId },
      quiet,
    );
  }
  if (fields.dueDate !== undefined) {
    await client.command(
      boardId,
      { type: "SET_CARD_DUE_DATE", cardId, dueDate: fields.dueDate },
      quiet,
    );
  }
}

/** The "not on this board" answer every card lookup shares. */
function cardNotFound(cardId: string, boardId: string) {
  return errorResult(
    `Error: card ${cardId} is not on board ${boardId}. Re-read the board ` +
      "with janosik_get_board for current ids.",
  );
}

export function registerCardTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_create_card",
    {
      title: "Create a card",
      description:
        "Create a card in a column. Optionally set its description, priority, " +
        "assignee and due date in the same call (each applied as a command). " +
        "Returns the new card id.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema,
        title: z.string().min(1).max(LIMITS.cardTitle).describe("Card title."),
        description: z
          .string()
          .max(LIMITS.description)
          .optional()
          .describe("Card description (markdown)."),
        priority: prioritySchema.optional(),
        assigneeId: idSchema
          .optional()
          .describe("Assignee user id (see janosik_list_members)."),
        dueDate: z
          .string()
          .optional()
          .describe("Due date, ISO-8601 (e.g. 2026-11-01T09:00:00Z)."),
        labelIds: z
          .array(idSchema)
          .max(LIMITS.labelsPerCard)
          .optional()
          .describe("Label ids to attach immediately."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Zero-based insert position in the column (defaults to the end).",
          ),
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      columnId,
      title,
      labelIds,
      position,
      description,
      priority,
      assigneeId,
      dueDate,
    }) => {
      // Validate everything the follow-up commands need first: once ADD_CARD
      // lands, a failure would leave a card the agent does not know about,
      // and a retry would create a duplicate.
      const due = dueDate !== undefined ? parseDueDate(dueDate) : undefined;
      if (assigneeId !== undefined) {
        const members = await client.listMembers(boardId);
        if (!members.some((member) => member.userId === assigneeId)) {
          return errorResult(
            `Error: ${assigneeId} is not a member of board ${boardId}. ` +
              "Pick an id from janosik_list_members.",
          );
        }
      }

      const newCardId = newId();
      await client.command(boardId, {
        type: "ADD_CARD",
        newCardId,
        columnId,
        title,
        ...(labelIds ? { labelIds } : {}),
        ...(position !== undefined ? { atIndex: position } : {}),
      });
      try {
        await applyCardFields(client, boardId, newCardId, {
          ...(description !== undefined ? { description } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(due !== undefined ? { dueDate: due } : {}),
        });
      } catch (error) {
        // The card exists: say so, so the agent fixes it instead of retrying.
        return errorResult(
          `Card "${title}" was created — \`${newCardId}\` — but setting its ` +
            `other fields failed: ${describeError(error)} Fix them with the ` +
            "card tools; do not create the card again.",
        );
      }
      return textOnly(`Created card "${title}" — \`${newCardId}\`.`);
    },
  );

  defineTool(
    server,
    "janosik_get_card",
    {
      title: "Get a card",
      description:
        "Read one card in full: fields, description, checklists and links, " +
        "plus the column it sits in.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, cardId, response_format }) => {
      const board = await client.getBoard(boardId);
      const card = Object.hasOwn(board.cards, cardId)
        ? board.cards[cardId]
        : undefined;
      if (!card) return cardNotFound(cardId, boardId);
      const location = findCardLocation(board, cardId);
      return respond(
        response_format,
        {
          card,
          columnId: location?.column.id ?? null,
          columnTitle: location?.column.title ?? null,
        },
        renderCard(card, board.labels),
      );
    },
  );

  defineTool(
    server,
    "janosik_update_card",
    {
      title: "Update a card",
      description:
        "Change a card's title and/or description. Only the fields you pass " +
        "are written. Several agents may edit one card: pass " +
        "expectedDescription (the text you read) to write only if nobody " +
        "changed the description since, instead of overwriting their edit.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        title: z
          .string()
          .min(1)
          .max(LIMITS.cardTitle)
          .optional()
          .describe("New title."),
        description: z
          .string()
          .max(LIMITS.description)
          .optional()
          .describe("New description (markdown). An empty string clears it."),
        expectedDescription: z
          .string()
          .max(LIMITS.description)
          .optional()
          .describe(
            "Compare-and-set: the description as you last read it. The write " +
              "is refused if the card's description differs now.",
          ),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, title, description, expectedDescription }) => {
      const patch = {
        type: "UPDATE_CARD" as const,
        cardId,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      };
      if (expectedDescription === undefined) {
        await client.command(boardId, patch);
        return textOnly(`Updated card ${cardId}.`);
      }
      // `ifMatch` pins the write to the board state the comparison ran on.
      const outcome = await client.commandOnFreshBoard(boardId, (board) => {
        const card = Object.hasOwn(board.cards, cardId)
          ? board.cards[cardId]
          : undefined;
        if (!card) return null;
        if ((card.description ?? "") !== expectedDescription) {
          return { result: "stale" };
        }
        return { action: patch, result: "ok" };
      });
      if (outcome === null) return cardNotFound(cardId, boardId);
      if (outcome === "stale") {
        return errorResult(
          `Error: card ${cardId}'s description changed since you read it. ` +
            "Re-read it with janosik_get_card, merge, and retry.",
        );
      }
      return textOnly(`Updated card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_move_card",
    {
      title: "Move a card",
      description:
        "Move a card to another column and/or position. Omit the destination " +
        "column to reorder within the current one; omit the position to " +
        "append at the end.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        toColumnId: columnIdSchema
          .optional()
          .describe(
            "Destination column (defaults to the card's current column).",
          ),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based insert position in the destination column."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, toColumnId, position }) => {
      // The source column/index come from the read, and `ifMatch` refuses
      // the move if another writer changed the board in between (the read
      // is then retried), so a concurrent move can never act on stale
      // coordinates.
      let missingColumn: string | null = null;
      const moved = await client.commandOnFreshBoard(boardId, (board) => {
        const location = findCardLocation(board, cardId);
        if (!location) return null;
        const destinationId = toColumnId ?? location.column.id;
        const destination = board.columns.find(
          (column) => column.id === destinationId,
        );
        if (!destination) {
          missingColumn = destinationId;
          return null;
        }
        // Within one column the card's own slot does not count.
        const slots =
          destination.id === location.column.id
            ? destination.cardIds.length - 1
            : destination.cardIds.length;
        const toIndex =
          position !== undefined ? Math.min(position, slots) : slots;
        return {
          action: {
            type: "MOVE_CARD",
            cardId,
            fromColumnId: location.column.id,
            fromIndex: location.index,
            toColumnId: destinationId,
            toIndex,
          },
          result: { title: destination.title, toIndex },
        };
      });
      if (missingColumn !== null) {
        return errorResult(
          `Error: column ${missingColumn} is not on board ${boardId}. ` +
            "Re-read the board with janosik_get_board for current ids.",
        );
      }
      if (moved === null) return cardNotFound(cardId, boardId);
      return textOnly(
        `Moved card ${cardId} to ${moved.title} at position ${moved.toIndex}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_duplicate_card",
    {
      title: "Duplicate a card",
      description:
        "Copy a card (description, checklists, due date, cover and labels) " +
        "into a new card placed right below the original.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        title: z
          .string()
          .max(LIMITS.cardTitle)
          .optional()
          .describe("Title for the copy."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, title }) => {
      const newCardId = newId();
      await client.command(boardId, {
        type: "DUPLICATE_CARD",
        cardId,
        newCardId,
        ...(title !== undefined ? { title } : {}),
      });
      return textOnly(`Duplicated card ${cardId} — \`${newCardId}\`.`);
    },
  );

  defineTool(
    server,
    "janosik_set_card_priority",
    {
      title: "Set a card priority",
      description: "Set a card's Jira-style priority.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        priority: prioritySchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, priority }) => {
      await client.command(boardId, {
        type: "SET_CARD_PRIORITY",
        cardId,
        priority,
      });
      return textOnly(`Set priority ${priority} on card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_set_card_assignee",
    {
      title: "Assign a card",
      description:
        "Assign a card to a board member, or unassign it. The assignee must " +
        "be an active member of the board (see janosik_list_members).",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        assigneeId: idSchema
          .nullable()
          .describe("Member user id, or null to unassign."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, assigneeId }) => {
      await client.command(boardId, {
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId,
      });
      return textOnly(
        assigneeId
          ? `Assigned card ${cardId} to ${assigneeId}.`
          : `Unassigned card ${cardId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_set_card_due_date",
    {
      title: "Set a card due date",
      description: "Set or clear a card's due date.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        dueDate: z
          .string()
          .nullable()
          .describe("ISO-8601 date/time, or null to clear the due date."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, dueDate }) => {
      const ms = parseDueDate(dueDate);
      await client.command(boardId, {
        type: "SET_CARD_DUE_DATE",
        cardId,
        ...(ms !== undefined ? { dueDate: ms } : {}),
      });
      return textOnly(
        ms !== undefined
          ? `Set due date ${new Date(ms).toISOString()} on card ${cardId}.`
          : `Cleared the due date on card ${cardId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_set_card_cover",
    {
      title: "Set a card cover",
      description:
        "Set or clear a card's colour/gradient cover stripe. Use " +
        "janosik_get_board to see available colours, or pass null to remove it.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        cover: coverSchema.nullable().describe("Cover, or null to remove it."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, cover }) => {
      await client.command(boardId, {
        type: "SET_CARD_COVER",
        cardId,
        ...(cover ? { cover } : {}),
      });
      return textOnly(
        cover
          ? `Set cover on card ${cardId}.`
          : `Removed the cover on card ${cardId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_archive_card",
    {
      title: "Archive a card",
      description:
        "Archive a card: it leaves its column but is kept and restorable. " +
        "Reverse it with janosik_unarchive_card.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId }) => {
      await client.command(boardId, { type: "ARCHIVE_CARD", cardId });
      return textOnly(`Archived card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_unarchive_card",
    {
      title: "Unarchive a card",
      description:
        "Restore an archived card into a column (defaults to the first column).",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        columnId: columnIdSchema.optional().describe("Target column."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based insert position."),
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, columnId, position }) => {
      await client.command(boardId, {
        type: "UNARCHIVE_CARD",
        cardId,
        ...(columnId !== undefined ? { columnId } : {}),
        ...(position !== undefined ? { index: position } : {}),
      });
      return textOnly(`Unarchived card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_card",
    {
      title: "Delete a card",
      description:
        "Delete a card permanently. Destructive — prefer janosik_archive_card " +
        "when the card might be needed again.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId }) => {
      await client.command(boardId, { type: "DELETE_CARD", cardId });
      return textOnly(`Deleted card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_search_cards",
    {
      title: "Search cards",
      description:
        "Find cards by text (title/description) and filters. Searches one " +
        "board, or every board the user can access when boardId is omitted. " +
        "Archived cards are excluded unless include_archived is set.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Case-insensitive text to match in title or description."),
        boardId: boardIdSchema
          .optional()
          .describe("Limit the search to one board."),
        labelId: idSchema.optional().describe("Only cards with this label."),
        priority: prioritySchema.optional(),
        assigneeId: idSchema
          .optional()
          .describe("Only cards assigned to this user."),
        include_archived: z
          .boolean()
          .default(false)
          .describe("Include archived cards."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe("Max results."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async (args) => {
      const boards = args.boardId
        ? [await client.getBoard(args.boardId)]
        : await loadBoards(client);
      const needle = args.query?.toLowerCase();
      const matches: Array<{ board: Board; card: Card; column: string }> = [];
      const matchesFilters = (card: Card): boolean =>
        !(args.labelId && !card.labelIds.includes(args.labelId)) &&
        !(args.priority && (card.priority ?? "medium") !== args.priority) &&
        !(args.assigneeId && card.assigneeId !== args.assigneeId) &&
        !(
          needle &&
          !card.title.toLowerCase().includes(needle) &&
          !(card.description?.toLowerCase().includes(needle) ?? false)
        );

      // A labelled break stops the whole scan once `limit` is reached, not
      // just the innermost loop.
      search: for (const board of boards) {
        for (const column of board.columns) {
          for (const cardId of column.cardIds) {
            const card = board.cards[cardId];
            if (!card || !matchesFilters(card)) continue;
            matches.push({ board, card, column: column.title });
            if (matches.length >= args.limit) break search;
          }
        }
        // Archiving takes a card out of its column, so archived cards are
        // only reachable through the card map.
        if (args.include_archived) {
          for (const card of Object.values(board.cards)) {
            if (card.archivedAt === undefined || !matchesFilters(card)) {
              continue;
            }
            matches.push({ board, card, column: "(archived)" });
            if (matches.length >= args.limit) break search;
          }
        }
      }

      const results = matches.map(({ board, card, column }) => ({
        id: card.id,
        title: card.title,
        boardId: board.id,
        boardTitle: board.title,
        column,
        priority: card.priority ?? "medium",
        assigneeId: card.assigneeId ?? null,
        dueDate: card.dueDate ?? null,
        archived: card.archivedAt !== undefined,
      }));
      const markdown =
        results.length === 0
          ? "No cards matched."
          : `# ${results.length} card(s)\n\n${results
              .map(
                (card) =>
                  `- ${card.title} — ${card.boardTitle} › ${card.column} — \`${card.id}\``,
              )
              .join("\n")}`;
      return respond(args.response_format, { results }, markdown);
    },
  );
}

/**
 * Fetch every board the caller can access, a few at a time so a cross-board
 * search does not burst the instance's rate limit.
 */
async function loadBoards(client: JanosikClient): Promise<Board[]> {
  const summaries = await client.listBoards();
  const boards: Board[] = [];
  for (let i = 0; i < summaries.length; i += SEARCH_CONCURRENCY) {
    const batch = summaries.slice(i, i + SEARCH_CONCURRENCY);
    boards.push(
      ...(await Promise.all(
        batch.map((summary) => client.getBoard(summary.id)),
      )),
    );
  }
  return boards;
}

/** Boards read in parallel by a cross-board search. */
const SEARCH_CONCURRENCY = 4;
