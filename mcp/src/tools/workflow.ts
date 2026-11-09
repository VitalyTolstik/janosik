/**
 * Read-only workflow tools. The workflow config is admin-owned; MCP can read
 * it and check which moves a card may take, but it never edits the rules.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  evaluateTransition,
  type Board,
  type BoardRole,
  type WorkflowCondition,
  workflowDoneColumnIds,
  workflowInitialColumnId,
} from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { errorResult, respond } from "../format.js";
import {
  boardIdSchema,
  cardIdSchema,
  responseFormatSchema,
} from "../schemas.js";
import { READ, defineTool } from "./helpers.js";

const CONDITION_LABELS: Record<WorkflowCondition, string> = {
  requireAssignee: "needs an assignee",
  requireDueDate: "needs a due date",
  requireDescription: "needs a description",
  requireChecklistsDone: "all checklist items must be done",
};

export function registerWorkflowTools(
  server: McpServer,
  client: JanosikClient,
): void {
  defineTool(
    server,
    "janosik_get_workflow",
    {
      title: "Read the board workflow",
      description:
        "Read the board's optional card workflow: its enabled flag, initial " +
        "and done columns, and the directed transitions (from → to) with " +
        "roles and conditions. Pass cardId to also check which columns that " +
        "card may move to right now. A board without a workflow allows every " +
        "move; moving is still subject to WIP limits and permissions.",
      inputSchema: {
        boardId: boardIdSchema,
        cardId: cardIdSchema
          .optional()
          .describe("Also evaluate this card's allowed moves."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, cardId, response_format }) => {
      const { board, seq } = await client.getBoardWithSeq(boardId);
      if (cardId !== undefined && !Object.hasOwn(board.cards, cardId)) {
        return errorResult(
          `Error: card ${cardId} is not on board ${boardId}. Read the board ` +
            "with janosik_get_board for current ids.",
        );
      }
      let role: BoardRole | undefined;
      if (cardId !== undefined) {
        // The aggregate does not carry the caller's role; the board summary
        // does. Only fetched when a per-card check was requested.
        const summaries = await client.listBoards();
        role = summaries.find((summary) => summary.id === boardId)?.role;
      }
      const payload = workflowPayload(board, cardId, role);
      return respond(
        response_format,
        { ...payload, seq },
        renderWorkflow(payload),
      );
    },
  );
}

interface CardTarget {
  columnId: string;
  title: string;
  allowed: boolean;
  code: string;
  failedConditions: WorkflowCondition[];
}

interface WorkflowPayload {
  enabled: boolean;
  present: boolean;
  schemaVersion: number | null;
  initialColumnId: string | null;
  initialColumnTitle: string | null;
  doneColumnIds: string[];
  doneColumnTitles: string[];
  columns: Array<{ id: string; title: string; wipLimit: number | null }>;
  transitions: Array<{
    id: string;
    fromColumnId: string | null;
    fromTitle: string;
    toColumnId: string;
    toTitle: string;
    roles: string[];
    conditions: WorkflowCondition[];
    label: string | null;
    enabled: boolean;
  }>;
  card: {
    id: string;
    title: string;
    columnId: string | null;
    columnTitle: string | null;
    role: BoardRole | null;
    allowedToColumnIds: string[];
    targets: CardTarget[];
  } | null;
}

function workflowPayload(
  board: Board,
  cardId: string | undefined,
  role: BoardRole | undefined,
): WorkflowPayload {
  const workflow = board.workflow;
  const initialColumnId = workflowInitialColumnId(board) ?? null;
  const doneColumnIds = workflowDoneColumnIds(board);
  const columnTitle = (id: string | null): string =>
    id === null
      ? "Any"
      : (board.columns.find((column) => column.id === id)?.title ?? id);

  let card: WorkflowPayload["card"] = null;
  if (cardId !== undefined) {
    const value = board.cards[cardId];
    const from = board.columns.find((column) =>
      column.cardIds.includes(cardId),
    );
    const targets: CardTarget[] = board.columns
      .filter((column) => column.id !== from?.id)
      .map((column) => {
        const decision = evaluateTransition(board, cardId, column.id, role);
        return {
          columnId: column.id,
          title: column.title,
          allowed: decision.allowed,
          code: decision.allowed ? "allowed" : decision.code,
          failedConditions: decision.allowed ? [] : decision.failedConditions,
        };
      });
    card = {
      id: cardId,
      title: value?.title ?? cardId,
      columnId: from?.id ?? null,
      columnTitle: from?.title ?? null,
      role: role ?? null,
      allowedToColumnIds: targets
        .filter((target) => target.allowed)
        .map((target) => target.columnId),
      targets,
    };
  }

  return {
    enabled: workflow?.enabled ?? false,
    present: workflow !== undefined,
    schemaVersion: workflow?.schemaVersion ?? null,
    initialColumnId,
    initialColumnTitle:
      initialColumnId === null ? null : columnTitle(initialColumnId),
    doneColumnIds,
    doneColumnTitles: doneColumnIds.map((id) => columnTitle(id)),
    columns: board.columns.map((column) => ({
      id: column.id,
      title: column.title,
      wipLimit: column.wipLimit ?? null,
    })),
    transitions: (workflow?.transitions ?? []).map((transition) => ({
      id: transition.id,
      fromColumnId: transition.fromColumnId,
      fromTitle: columnTitle(transition.fromColumnId),
      toColumnId: transition.toColumnId,
      toTitle: columnTitle(transition.toColumnId),
      roles: transition.allowedRoles ?? ["ADMIN", "MEMBER"],
      conditions: transition.conditions ?? [],
      label: transition.label ?? null,
      enabled: transition.enabled !== false,
    })),
    card,
  };
}

function renderWorkflow(payload: WorkflowPayload): string {
  const lines: string[] = [
    `# Workflow`,
    "",
    payload.present
      ? `Control: **${payload.enabled ? "enabled" : "disabled"}** · ${payload.transitions.length} transition(s)`
      : "Control: **not configured** — every move is allowed.",
    `Initial column: ${payload.initialColumnTitle ?? "—"}`,
    `Done column(s): ${payload.doneColumnTitles.join(", ") || "—"}`,
  ];

  if (payload.transitions.length > 0) {
    lines.push("", "## Transitions", "");
    for (const transition of payload.transitions) {
      const conditions =
        transition.conditions.length > 0
          ? ` · conditions: ${transition.conditions
              .map((condition) => CONDITION_LABELS[condition])
              .join("; ")}`
          : "";
      const disabled = transition.enabled ? "" : " (disabled)";
      lines.push(
        `- **${transition.fromTitle} → ${transition.toTitle}** · ` +
          `${transition.roles.join(" / ")}${conditions}${disabled}`,
      );
    }
  }

  if (payload.card) {
    const card = payload.card;
    lines.push(
      "",
      `## Card check: ${card.title}`,
      "",
      `Current column: ${card.columnTitle ?? "—"} · role: ${card.role ?? "unknown"}`,
    );
    if (card.targets.length === 0) {
      lines.push("- No other column on this board.");
    }
    for (const target of card.targets) {
      if (target.allowed) {
        lines.push(`- **${target.title}** — allowed`);
      } else {
        const reason =
          target.code === "condition_failed"
            ? `conditions: ${target.failedConditions
                .map((condition) => CONDITION_LABELS[condition])
                .join("; ")}`
            : target.code === "role_not_allowed"
              ? "your role is not allowed"
              : "no transition from this column";
        lines.push(`- **${target.title}** — blocked (${reason})`);
      }
    }
  }
  return lines.join("\n");
}
