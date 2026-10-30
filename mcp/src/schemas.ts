/**
 * Zod building blocks shared by the tool input schemas. Enum values come
 * straight from `@janosik/shared`, so the server can never drift from what
 * the API actually accepts.
 */

import { z } from "zod";

import {
  CARD_LINK_TYPES,
  CARD_PRIORITIES,
  COVER_COLORS,
  COVER_GRADIENTS,
  LABEL_COLORS,
} from "@janosik/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";
import { RESPONSE_FORMATS } from "./format.js";

/** Label colours: the live palette plus the retired `amber` the API still accepts. */
const LABEL_COLOR_VALUES = [...LABEL_COLORS, "amber"] as const;

export const responseFormatSchema = z
  .enum(RESPONSE_FORMATS)
  .default("markdown")
  .describe(
    "Output format: 'markdown' (default, human-readable) or 'json' " +
      "(machine-readable, full fields).",
  );

/**
 * Every id the app mints is a UUID, a cuid or a seed slug, so ids are
 * restricted to URL-safe characters. Besides catching hallucinated values
 * early, this keeps an id from ever being a path segment such as `..` that
 * would re-target the request to another route.
 */
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "must be an id as returned by Janosik");

export const boardIdSchema = idSchema.describe(
  "Board id (from janosik_list_boards).",
);

export const cardIdSchema = idSchema.describe(
  "Card id (from janosik_get_board).",
);

export const columnIdSchema = idSchema.describe(
  "Column id (from janosik_get_board).",
);

export const labelColorSchema = z
  .enum(LABEL_COLOR_VALUES)
  .describe(`Label colour, one of: ${LABEL_COLOR_VALUES.join(", ")}.`);

export const prioritySchema = z
  .enum(CARD_PRIORITIES)
  .describe(`Priority, one of: ${CARD_PRIORITIES.join(", ")}.`);

export const linkTypeSchema = z
  .enum(CARD_LINK_TYPES)
  .describe(
    "Link type: 'blocks' (this card blocks the other), 'relates_to', or " +
      "'duplicates'.",
  );

export const roleSchema = z
  .enum(["ADMIN", "MEMBER", "VIEWER"])
  .describe(
    "Board role: ADMIN (manages board and members), MEMBER (edits " +
      "content), VIEWER (read-only).",
  );

/** A colour cover takes a colour name, a gradient cover a gradient name. */
export const coverSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("color"),
      value: z
        .enum(COVER_COLORS)
        .describe(`Colour name: ${COVER_COLORS.join(", ")}.`),
    }),
    z.object({
      type: z.literal("gradient"),
      value: z
        .enum(COVER_GRADIENTS)
        .describe(`Gradient name: ${COVER_GRADIENTS.join(", ")}.`),
    }),
  ])
  .describe("Card cover stripe.");

/**
 * Read projection (TASK-157, E16). 'full' returns every card as stored;
 * 'summary' drops each card's description and checklists (keeping a size
 * hint), so scanning a board whose cards carry 64k documents stays small.
 * Each tool picks its own default.
 */
export const detailSchema = z
  .enum(["summary", "full"])
  .describe(
    "Read projection: 'full' includes each card's description and " +
      "checklists; 'summary' omits them (a size hint is kept).",
  );

/** A cursor-paginated page request (comments, activity). */
export const pageSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from a previous page's next_cursor."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      `Items per page (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}).`,
    ),
});

export { z };
