/**
 * Card tools: create (with optional fields applied in one call), read, update,
 * move, duplicate, archive/unarchive, delete, set priority / assignee / due
 * date / cover, and search. Every write is one or more command-log actions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  CARD_PRIORITIES,
  CLAIM_LEASE_DEFAULT_MS,
  CLAIM_LEASE_MAX_MS,
  CLAIM_LEASE_MIN_MS,
  DEFAULT_CARD_PRIORITY,
  LIMITS,
  type Board,
  type Card,
} from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { describeError } from "../errors.js";
import { errorResult, respond, textOnly } from "../format.js";
import { newId } from "../ids.js";
import { findCardLocation } from "../locate.js";
import { blockedIds } from "../project.js";
import { renderCard } from "../render.js";
import {
  boardIdSchema,
  cardIdSchema,
  columnIdSchema,
  coverSchema,
  detailSchema,
  expectedVersionSchema,
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

/** Characters of a card description shown by `search_cards` in full mode. */
const DESCRIPTION_SNIPPET = 280;

/** A short prefix of a description, or null when the card has none. */
function descriptionSnippet(description: string | undefined): string | null {
  if (!description) return null;
  return description.length > DESCRIPTION_SNIPPET
    ? `${description.slice(0, DESCRIPTION_SNIPPET)}…`
    : description;
}

/** The "not on this board" answer every card lookup shares. */
function cardNotFound(cardId: string, boardId: string) {
  return errorResult(
    `Error: card ${cardId} is not on board ${boardId}. Re-read the board ` +
      "with janosik_get_board for current ids.",
  );
}

/**
 * The Definition-of-Done gate (TASK-157, D12): why a card may not enter the
 * Done column, or null when it may. A card without a task contract (no
 * `definitionOfDone` task spec and no `Definition of Done` checklist) is not
 * gated — the rule only binds cards that claim a contract.
 */
async function dodBlock(
  client: JanosikClient,
  card: Card,
): Promise<string | null> {
  const dodChecklist = card.checklists?.find((list) =>
    /^definition of done$/i.test(list.title.trim()),
  );
  const hasContract =
    (card.definitionOfDone?.length ?? 0) > 0 || dodChecklist !== undefined;
  if (!hasContract) return null;
  const unchecked = dodChecklist?.items.filter((item) => !item.done) ?? [];
  if (unchecked.length > 0) {
    return (
      `Error: card ${card.id}'s Definition of Done still has ` +
      `${unchecked.length} unchecked item(s). Tick them with ` +
      "janosik_set_checklist_item_done before moving the card to Done."
    );
  }
  const evidence = await client.listComments(
    card.id,
    undefined,
    100,
    "evidence",
  );
  if (evidence.items.length === 0) {
    return (
      `Error: card ${card.id} has no evidence comment. Post one with ` +
      'janosik_add_comment (kind="evidence") before moving the card to Done.'
    );
  }
  return null;
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
        cardId: idSchema
          .optional()
          .describe(
            "Client id for the new card (TASK-157, E14). Pass a stable id so " +
              "a retried call returns the first card instead of a duplicate.",
          ),
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      columnId,
      cardId,
      title,
      labelIds,
      position,
      description,
      priority,
      assigneeId,
      dueDate,
      expectedVersion,
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

      const newCardId = cardId ?? newId();
      await client.command(
        boardId,
        {
          type: "ADD_CARD",
          newCardId,
          columnId,
          title,
          ...(labelIds ? { labelIds } : {}),
          ...(position !== undefined ? { atIndex: position } : {}),
        },
        // A client id doubles as the idempotency key, so a retry is a no-op.
        {
          ifMatch: expectedVersion,
          ...(cardId ? { commandId: cardId } : {}),
        },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      cardId,
      title,
      description,
      expectedDescription,
      expectedVersion,
    }) => {
      const patch = {
        type: "UPDATE_CARD" as const,
        cardId,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      };
      if (expectedDescription === undefined) {
        await client.command(boardId, patch, { ifMatch: expectedVersion });
        return textOnly(`Updated card ${cardId}.`);
      }
      // `ifMatch` pins the write to the board state the comparison ran on.
      const outcome = await client.commandOnFreshBoard(
        boardId,
        (board) => {
          const card = Object.hasOwn(board.cards, cardId)
            ? board.cards[cardId]
            : undefined;
          if (!card) return null;
          if ((card.description ?? "") !== expectedDescription) {
            return { result: "stale" };
          }
          return { action: patch, result: "ok" };
        },
        3,
        expectedVersion,
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, toColumnId, position, expectedVersion }) => {
      // Definition-of-Done gate (TASK-157, D12). The board's *last* column is
      // its "Done" column (the same heuristic the OG image uses); a card that
      // carries a task contract may only enter it once its `Definition of
      // Done` checklist is fully ticked and it has an evidence comment. This
      // is the anti-"green fence built from lies" rule — a swarm cannot mark
      // work done on its own say-so.
      //
      // The read below serves both the gate and the move: the snapshot is
      // handed to `commandOnFreshBoard`, so a move costs one `GET` (not two,
      // TASK-154) and only re-reads on a version conflict.
      const { board: before, seq } = await client.getBoardWithSeq(boardId);
      const origin = findCardLocation(before, cardId);
      if (origin === null) return cardNotFound(cardId, boardId);
      const destinationId = toColumnId ?? origin.column.id;
      const doneColumnId = before.columns.at(-1)?.id;
      if (
        destinationId === doneColumnId &&
        destinationId !== origin.column.id
      ) {
        const block = await dodBlock(client, before.cards[cardId]!);
        if (block !== null) return errorResult(block);
      }

      // The source column/index come from the read, and `ifMatch` refuses
      // the move if another writer changed the board in between (the read
      // is then retried), so a concurrent move can never act on stale
      // coordinates.
      let missingColumn: string | null = null;
      const moved = await client.commandOnFreshBoard(
        boardId,
        (board) => {
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
        },
        3,
        expectedVersion,
        { board: before, seq },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, title, expectedVersion }) => {
      const newCardId = newId();
      await client.command(
        boardId,
        {
          type: "DUPLICATE_CARD",
          cardId,
          newCardId,
          ...(title !== undefined ? { title } : {}),
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, priority, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_CARD_PRIORITY",
          cardId,
          priority,
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, assigneeId, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_CARD_ASSIGN",
          cardId,
          assigneeId,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(
        assigneeId
          ? `Assigned card ${cardId} to ${assigneeId}.`
          : `Unassigned card ${cardId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_claim_card",
    {
      title: "Claim a card",
      description:
        "Take a temporary work lease on a card (TASK-157) — how a swarm " +
        "avoids two agents working the same card. The lease expires on its " +
        "own, so a dead agent never leaves the card stuck. Refused if another " +
        "member still holds a live lease: read the card, or pick another.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        leaseMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Lease length in ms (default 15 min, clamped to [1 min, 24 h]).",
          ),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, leaseMs, expectedVersion }) => {
      const user = await client.whoami();
      const duration = Math.min(
        Math.max(leaseMs ?? CLAIM_LEASE_DEFAULT_MS, CLAIM_LEASE_MIN_MS),
        CLAIM_LEASE_MAX_MS,
      );
      const leaseUntil = Date.now() + duration;
      await client.command(
        boardId,
        {
          type: "CLAIM_CARD",
          cardId,
          claimedBy: user.id,
          leaseUntil,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(
        `Claimed card ${cardId} until ${new Date(leaseUntil).toISOString()}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_release_card",
    {
      title: "Release a card",
      description:
        "Release your work lease on a card, or clear a lapsed one, so " +
        "another agent can pick it up.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "CLAIM_CARD",
          cardId,
          claimedBy: null,
          leaseUntil: null,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Released card ${cardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_set_card_task_spec",
    {
      title: "Set a card's task spec",
      description:
        "Set the card's machine-readable task contract (TASK-157): the " +
        "acceptance criteria and/or the definition of done, as lists of " +
        "short strings an agent reads directly instead of parsing prose. " +
        "Omit a field to leave it unchanged; pass an empty list to clear it.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema,
        acceptanceCriteria: z
          .array(z.string().max(LIMITS.taskSpecItem))
          .max(LIMITS.taskSpecItems)
          .optional()
          .describe("Acceptance criteria items. An empty list clears it."),
        definitionOfDone: z
          .array(z.string().max(LIMITS.taskSpecItem))
          .max(LIMITS.taskSpecItems)
          .optional()
          .describe("Definition-of-done items. An empty list clears it."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      cardId,
      acceptanceCriteria,
      definitionOfDone,
      expectedVersion,
    }) => {
      if (acceptanceCriteria === undefined && definitionOfDone === undefined) {
        return errorResult(
          "Error: pass acceptanceCriteria and/or definitionOfDone.",
        );
      }
      await client.command(
        boardId,
        {
          type: "SET_CARD_TASK_SPEC",
          cardId,
          ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
          ...(definitionOfDone !== undefined ? { definitionOfDone } : {}),
        },
        { ifMatch: expectedVersion },
      );
      const parts: string[] = [];
      if (acceptanceCriteria !== undefined) {
        parts.push(`${acceptanceCriteria.length} acceptance criteria`);
      }
      if (definitionOfDone !== undefined) {
        parts.push(`${definitionOfDone.length} definition-of-done items`);
      }
      return textOnly(`Set ${parts.join(" and ")} on card ${cardId}.`);
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, dueDate, expectedVersion }) => {
      const ms = parseDueDate(dueDate);
      await client.command(
        boardId,
        {
          type: "SET_CARD_DUE_DATE",
          cardId,
          ...(ms !== undefined ? { dueDate: ms } : {}),
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, cover, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "SET_CARD_COVER",
          cardId,
          ...(cover ? { cover } : {}),
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "ARCHIVE_CARD", cardId },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, columnId, position, expectedVersion }) => {
      await client.command(
        boardId,
        {
          type: "UNARCHIVE_CARD",
          cardId,
          ...(columnId !== undefined ? { columnId } : {}),
          ...(position !== undefined ? { index: position } : {}),
        },
        { ifMatch: expectedVersion },
      );
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
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "DELETE_CARD", cardId },
        { ifMatch: expectedVersion },
      );
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
        detail: detailSchema
          .default("summary")
          .describe(
            "Read projection: 'summary' (default) returns each card's " +
              "identity and badges only; 'full' adds a description snippet " +
              "(a size hint) so a 64k document does not bloat the results.",
          ),
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
      const needle = args.query?.trim().toLowerCase();
      // Comment text is not in the board aggregate, so a query also asks the
      // server which cards match (TASK-157, D11). Best-effort: an older
      // instance without the search route falls back to title/description/
      // checklist matching below.
      const serverText =
        needle && args.query
          ? await loadTextMatches(client, boards, args.query.trim())
          : new Map<string, Set<string>>();
      const matches: Array<{ board: Board; card: Card; column: string }> = [];
      const matchesFilters = (card: Card, boardId: string): boolean =>
        !(args.labelId && !card.labelIds.includes(args.labelId)) &&
        !(args.priority && (card.priority ?? "medium") !== args.priority) &&
        !(args.assigneeId && card.assigneeId !== args.assigneeId) &&
        (!needle || matchesText(card, boardId, needle, serverText));

      // A labelled break stops the whole scan once `limit` is reached, not
      // just the innermost loop.
      search: for (const board of boards) {
        for (const column of board.columns) {
          for (const cardId of column.cardIds) {
            const card = board.cards[cardId];
            if (!card || !matchesFilters(card, board.id)) continue;
            matches.push({ board, card, column: column.title });
            if (matches.length >= args.limit) break search;
          }
        }
        // Archiving takes a card out of its column, so archived cards are
        // only reachable through the card map.
        if (args.include_archived) {
          for (const card of Object.values(board.cards)) {
            if (
              card.archivedAt === undefined ||
              !matchesFilters(card, board.id)
            ) {
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
        ...(args.detail === "full"
          ? {
              description: descriptionSnippet(card.description),
              descriptionChars: card.description?.length ?? 0,
            }
          : {}),
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

  defineTool(
    server,
    "janosik_list_ready_cards",
    {
      title: "List cards ready to work",
      description:
        "Cards an agent can pick up right now: in the board's first " +
        "(Backlog) column, unassigned, not under a live claim and not " +
        "blocked by another card. Sorted by priority (most urgent first). " +
        "Reads one board, or every board the user can access when boardId is " +
        "omitted.",
      inputSchema: {
        boardId: boardIdSchema.optional().describe("Limit to one board."),
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
      const ready = readyCards(boards, Date.now()).slice(0, args.limit);
      const results = ready.map(({ board, card, column }) => ({
        id: card.id,
        title: card.title,
        boardId: board.id,
        boardTitle: board.title,
        column,
        priority: card.priority ?? DEFAULT_CARD_PRIORITY,
        descriptionChars: card.description?.length ?? 0,
      }));
      const markdown =
        results.length === 0
          ? "No cards are ready to work."
          : `# ${results.length} card(s) ready\n\n${results
              .map(
                (card) =>
                  `- ${card.title} — ${card.boardTitle} › ${card.column} — ${card.priority} — \`${card.id}\``,
              )
              .join("\n")}`;
      return respond(args.response_format, { results }, markdown);
    },
  );

  defineTool(
    server,
    "janosik_wait_for_work",
    {
      title: "Wait for a ready card",
      description:
        "Block until a card is ready to work (see janosik_list_ready_cards) " +
        "or the timeout passes, so an idle agent makes one call instead of " +
        "polling. Returns the ready card, or null on timeout.",
      inputSchema: {
        boardId: boardIdSchema.optional().describe("Limit to one board."),
        timeoutMs: z
          .number()
          .int()
          .min(0)
          .max(300_000)
          .default(30_000)
          .describe("How long to wait, in ms (max 5 min)."),
        pollMs: z
          .number()
          .int()
          .min(250)
          .max(30_000)
          .default(5_000)
          .describe("How often to re-check, in ms."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, timeoutMs, pollMs, response_format }) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const boards = boardId
          ? [await client.getBoard(boardId)]
          : await loadBoards(client);
        const [first] = readyCards(boards, Date.now());
        if (first) {
          const result = {
            id: first.card.id,
            title: first.card.title,
            boardId: first.board.id,
            boardTitle: first.board.title,
            column: first.column,
            priority: first.card.priority ?? DEFAULT_CARD_PRIORITY,
          };
          return respond(
            response_format,
            { card: result },
            `# Work available\n\n- ${result.title} — ${result.boardTitle} › ${result.column} — \`${result.id}\``,
          );
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return respond(
            response_format,
            { card: null },
            "No card became ready before the timeout.",
          );
        }
        await sleep(Math.min(pollMs, remaining));
      }
    },
  );
}

/** Cards ready to pick up, in priority order (TASK-157, E15). */
function readyCards(
  boards: Board[],
  now: number,
): Array<{ board: Board; card: Card; column: string }> {
  const out: Array<{ board: Board; card: Card; column: string }> = [];
  for (const board of boards) {
    const backlog = board.columns[0];
    if (!backlog) continue;
    const blocked = blockedIds(board);
    for (const cardId of backlog.cardIds) {
      const card = board.cards[cardId];
      if (!card) continue;
      if (card.assigneeId !== undefined) continue;
      if (card.claimedBy !== undefined && (card.leaseUntil ?? 0) > now)
        continue;
      if (blocked.has(card.id)) continue;
      out.push({ board, card, column: backlog.title });
    }
  }
  // Stable sort keeps board/column order within a priority band.
  out.sort(
    (a, b) => priorityRank(a.card.priority) - priorityRank(b.card.priority),
  );
  return out;
}

/** Most-urgent-first rank of a card's priority. */
function priorityRank(priority: Card["priority"]): number {
  const index = CARD_PRIORITIES.indexOf(priority ?? DEFAULT_CARD_PRIORITY);
  return index === -1 ? CARD_PRIORITIES.length : index;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Whether a card's title, description or a checklist item contains `needle`. */
function matchesText(
  card: Card,
  boardId: string,
  needle: string,
  serverText: Map<string, Set<string>>,
): boolean {
  if (card.title.toLowerCase().includes(needle)) return true;
  if (card.description?.toLowerCase().includes(needle)) return true;
  if (
    card.checklists?.some((list) =>
      list.items.some((item) => item.text.toLowerCase().includes(needle)),
    )
  ) {
    return true;
  }
  return serverText.get(boardId)?.has(card.id) ?? false;
}

/**
 * Ask each board which of its cards match `query` (title, description,
 * checklist item or comment). Boards are queried a few at a time; a board
 * whose search route is unavailable (an older instance) is skipped, leaving
 * the client-side match to stand in.
 */
async function loadTextMatches(
  client: JanosikClient,
  boards: Board[],
  query: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < boards.length; i += SEARCH_CONCURRENCY) {
    const batch = boards.slice(i, i + SEARCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (board) => {
        try {
          const result = await client.searchBoardCards(board.id, query);
          out.set(board.id, new Set(result.cardIds));
        } catch {
          /* older instance: no server search, the client-side match stands in */
        }
      }),
    );
  }
  return out;
}
