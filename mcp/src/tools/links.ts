/**
 * Card-link tools: relate two cards (blocks / relates to / duplicates).
 * Removal resolves the link row from the card's own links, so an agent can
 * name the two cards instead of the internal row id.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { JanosikClient } from "../client.js";
import { errorResult, textOnly } from "../format.js";
import { newId } from "../ids.js";
import {
  boardIdSchema,
  cardIdSchema,
  expectedVersionSchema,
  idSchema,
  linkTypeSchema,
} from "../schemas.js";
import { DESTRUCTIVE, WRITE, defineTool } from "./helpers.js";

export function registerLinkTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_add_card_link",
    {
      title: "Link two cards",
      description:
        "Create a relationship from one card to another. 'blocks' also " +
        "surfaces a red 'Blocked' badge on the blocked card; a cycle of " +
        "'blocks' links is refused.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema.describe("The source card the link is stored on."),
        targetCardId: idSchema.describe("The card on the other end."),
        linkType: linkTypeSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, cardId, targetCardId, linkType, expectedVersion }) => {
      const linkId = newId();
      await client.command(
        boardId,
        {
          type: "ADD_CARD_LINK",
          cardId,
          linkId,
          targetCardId,
          linkType,
        },
        { ifMatch: expectedVersion },
      );
      return textOnly(
        `Linked card ${cardId} --${linkType}--> ${targetCardId}.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_remove_card_link",
    {
      title: "Remove a card link",
      description:
        "Remove a link between two cards. Identify the pair by the source " +
        "and target card ids (optionally the link type when both exist).",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema.describe("The source card holding the link."),
        targetCardId: idSchema.describe("The card on the other end."),
        linkType: linkTypeSchema
          .optional()
          .describe("Type, when the pair has more than one relation."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId, cardId, targetCardId, linkType, expectedVersion }) => {
      const link = await client.commandOnFreshBoard(
        boardId,
        (board) => {
          const card = Object.hasOwn(board.cards, cardId)
            ? board.cards[cardId]
            : undefined;
          const found = card?.links?.find(
            (entry) =>
              entry.targetCardId === targetCardId &&
              (linkType === undefined || entry.type === linkType),
          );
          if (!found) return null;
          return {
            action: {
              type: "REMOVE_CARD_LINK",
              cardId,
              linkId: found.id,
              targetCardId: found.targetCardId,
              linkType: found.type,
            },
            result: found,
          };
        },
        3,
        expectedVersion,
      );
      if (!link) {
        return errorResult(
          `Error: no link from ${cardId} to ${targetCardId} was found on the ` +
            "board.",
        );
      }
      return textOnly(`Removed the ${link.type} link to ${targetCardId}.`);
    },
  );
}
