/**
 * Board-level tools: list, read, create, rename, archive/unarchive, delete and
 * the JSON export/import envelope. Content changes go through the command log;
 * creating a board and import are REST endpoints.
 */

import { LIMITS, type Board } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { errorResult, respond, textOnly } from "../format.js";
import { writeSandboxedFile, type FsOptions } from "../fs-policy.js";
import { summarizeBoard } from "../project.js";
import { renderBoard, renderBoardSummaries } from "../render.js";
import {
  boardIdSchema,
  columnIdSchema,
  detailSchema,
  expectedVersionSchema,
  responseFormatSchema,
} from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

/**
 * A board narrowed for reading: optionally one column, and archived cards
 * only on request. A swarm board quickly outgrows one response, so the
 * reader asks for the slice it needs.
 */
function sliceBoard(
  board: Board,
  columnId: string | undefined,
  includeArchived: boolean,
): Board | null {
  const columns =
    columnId === undefined
      ? board.columns
      : board.columns.filter((column) => column.id === columnId);
  if (columnId !== undefined && columns.length === 0) return null;
  const keep = new Set(columns.flatMap((column) => column.cardIds));
  const cards = Object.fromEntries(
    Object.entries(board.cards).filter(([id, card]) =>
      card.archivedAt !== undefined ? includeArchived : keep.has(id),
    ),
  );
  return { ...board, columns, cards };
}

export function registerBoardTools(
  server: McpServer,
  client: JanosikClient,
  fsOptions: FsOptions,
) {
  defineTool(
    server,
    "janosik_list_boards",
    {
      title: "List Janosik boards",
      description:
        "List every board the authenticated user can access, with the " +
        "caller's role and card/column counters. Use it first to find a " +
        "board id for the other tools.",
      inputSchema: { response_format: responseFormatSchema },
      annotations: READ,
    },
    async ({ response_format }) => {
      const boards = await client.listBoards();
      return respond(response_format, { boards }, renderBoardSummaries(boards));
    },
  );

  defineTool(
    server,
    "janosik_get_board",
    {
      title: "Get a Janosik board",
      description:
        "Read a board: columns with their cards, every card's badges, the " +
        "label set and the board version (`seq`). Card and column ids returned " +
        "here are what the other tools expect; pass `seq` as a write's " +
        "expectedVersion to refuse a write that would clobber a concurrent " +
        "change. On a large board pass columnId to read one column; archived " +
        "cards are listed only with include_archived. Pass detail='summary' to " +
        "skip each card's description and checklists.",
      inputSchema: {
        boardId: boardIdSchema,
        columnId: columnIdSchema
          .optional()
          .describe("Read only this column (and its cards)."),
        include_archived: z
          .boolean()
          .default(false)
          .describe("Also list the board's archived cards."),
        detail: detailSchema
          .default("full")
          .describe(
            "Read projection: 'full' (default) includes each card's " +
              "description and checklists; 'summary' omits them (a size hint " +
              "is kept) — use it to scan a board whose cards carry long " +
              "documents. Read a single card with janosik_get_card for the " +
              "full text.",
          ),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({
      boardId,
      columnId,
      include_archived,
      detail,
      response_format,
    }) => {
      const { board: full, seq } = await client.getBoardWithSeq(boardId);
      const board = sliceBoard(full, columnId, include_archived);
      if (board === null) {
        return errorResult(
          `Error: column ${columnId} is not on board ${boardId}. Call ` +
            "janosik_get_board without columnId for current ids.",
        );
      }
      const hint = "Pass columnId to read one column at a time.";
      if (detail === "summary") {
        return respond(
          response_format,
          { board: summarizeBoard(board), seq },
          `${renderBoard(board)}\n\n_(summary: descriptions and checklists ` +
            "omitted — read a card with janosik_get_card for the full text.)_",
          hint,
        );
      }
      return respond(response_format, { board, seq }, renderBoard(board), hint);
    },
  );

  defineTool(
    server,
    "janosik_create_board",
    {
      title: "Create a Janosik board",
      description:
        "Create a new empty board with the given title and return it. The " +
        "new board has no columns yet — add them with janosik_create_column.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(LIMITS.boardTitle)
          .describe("Board title."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ title, response_format }) => {
      const board = await client.createBoard(title);
      return respond(response_format, { board }, renderBoard(board));
    },
  );

  defineTool(
    server,
    "janosik_rename_board",
    {
      title: "Rename a Janosik board",
      description: "Change a board's title.",
      inputSchema: {
        boardId: boardIdSchema,
        title: z
          .string()
          .min(1)
          .max(LIMITS.boardTitle)
          .describe("New board title."),
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, title, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "RENAME_BOARD", title },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Renamed board ${boardId} to "${title}".`);
    },
  );

  defineTool(
    server,
    "janosik_archive_board",
    {
      title: "Archive a Janosik board",
      description:
        "Archive a board: its data is kept but it disappears from the " +
        "normal board list. Reverse it with janosik_unarchive_board.",
      inputSchema: {
        boardId: boardIdSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "ARCHIVE_BOARD" },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Archived board ${boardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_unarchive_board",
    {
      title: "Unarchive a Janosik board",
      description: "Bring an archived board back to the active list.",
      inputSchema: {
        boardId: boardIdSchema,
        expectedVersion: expectedVersionSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, expectedVersion }) => {
      await client.command(
        boardId,
        { type: "UNARCHIVE_BOARD" },
        { ifMatch: expectedVersion },
      );
      return textOnly(`Unarchived board ${boardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_delete_board",
    {
      title: "Delete a Janosik board",
      description:
        "Delete a board (ADMIN only). This is destructive: the board and its " +
        "cards are removed. Prefer janosik_archive_board when you may need it " +
        "back.",
      inputSchema: { boardId: boardIdSchema },
      annotations: DESTRUCTIVE,
    },
    async ({ boardId }) => {
      await client.deleteBoard(boardId);
      return textOnly(`Deleted board ${boardId}.`);
    },
  );

  defineTool(
    server,
    "janosik_export_board",
    {
      title: "Export a Janosik board",
      description:
        "Return a board as a portable JSON envelope (the same format the app " +
        "imports/exports), for backups or janosik_import_board on another " +
        "instance. A large board does not fit in a response: pass outputPath " +
        "to save it to a file instead (needs JANOSIK_MCP_ALLOW_FS=1).",
      inputSchema: {
        boardId: boardIdSchema,
        outputPath: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Save the envelope to this NEW file instead of returning it " +
              "(relative paths resolve against JANOSIK_MCP_FS_ROOT).",
          ),
        response_format: responseFormatSchema,
      },
      // With outputPath it writes a local file, so it is not read-only.
      annotations: WRITE,
    },
    async ({ boardId, outputPath, response_format }) => {
      const envelope = await client.exportBoard(boardId);
      const text = JSON.stringify(envelope, null, 2);
      if (outputPath !== undefined) {
        const saved = await writeSandboxedFile(outputPath, fsOptions, text);
        return textOnly(`Exported board ${boardId} to ${saved}.`);
      }
      // Never return a truncated envelope: it would not import.
      if (text.length > CHARACTER_LIMIT) {
        return errorResult(
          `Error: the export is ${text.length} characters, too large to ` +
            "return. Pass outputPath to save it to a file.",
        );
      }
      return respond(
        response_format,
        { envelope: envelope as unknown as Record<string, unknown> },
        `# Export of board ${boardId}\n\n\`\`\`json\n${text}\n\`\`\``,
      );
    },
  );

  defineTool(
    server,
    "janosik_import_board",
    {
      title: "Import a Janosik board",
      description:
        "Create boards from a JSON envelope produced by janosik_export_board " +
        "(or the app's export). Returns the imported boards.",
      inputSchema: {
        envelope: z
          .record(z.string(), z.unknown())
          .describe("The board envelope object to import."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ envelope, response_format }) => {
      const boards = await client.importBoards(
        envelope as unknown as Parameters<JanosikClient["importBoards"]>[0],
      );
      return respond(
        response_format,
        { boards },
        `Imported ${boards.length} board(s).\n\n${boards
          .map((board) => `- ${board.title} — \`${board.id}\``)
          .join("\n")}`,
      );
    },
  );
}
