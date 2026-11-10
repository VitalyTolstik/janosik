/**
 * Run tools (TASK-166.7): read the board's agent runs and preview a rollback.
 *
 * Applying a revert is deliberately absent from MCP (ADR D17): rollback is a
 * human board-ADMIN action in the browser. An agent may inspect a run and its
 * conflicts, then ask a human to perform the revert.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgentRunDto } from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { bullets, code, formatTimestamp, respond } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { READ, defineTool } from "./helpers.js";

function renderRun(run: AgentRunDto): string {
  return [
    `# Run ${code(run.id)}`,
    `- status: **${run.status}** · kind: ${run.kind}`,
    `- board: ${code(run.boardId)}`,
    `- commands: ${run.commandCount}${
      run.firstSeq !== null && run.lastSeq !== null
        ? ` · seq ${run.firstSeq}–${run.lastSeq}`
        : ""
    }`,
    `- created: ${formatTimestamp(run.createdAt)} · applied: ${formatTimestamp(run.appliedAt)}`,
    ...(run.apiTokenId ? [`- token: ${code(run.apiTokenId)}`] : []),
    ...(run.agentSessionId ? [`- session: ${code(run.agentSessionId)}`] : []),
    ...(run.clientRunId ? [`- client run: ${code(run.clientRunId)}`] : []),
    ...(run.approvalId ? [`- approval: ${code(run.approvalId)}`] : []),
    ...(run.revertsRunId ? [`- reverts run: ${code(run.revertsRunId)}`] : []),
    ...(run.revertedAt
      ? [`- reverted: ${formatTimestamp(run.revertedAt)}`]
      : []),
  ].join("\n");
}

function renderRuns(runs: AgentRunDto[]): string {
  if (runs.length === 0) return "# Runs\n\n_(none)_";
  return [
    `# Runs (${runs.length})`,
    "",
    ...bullets(
      runs.map(
        (run) =>
          `${code(run.id)} — **${run.status}** · ${run.kind} · ${run.commandCount} command(s) · ${formatTimestamp(run.createdAt)}`,
      ),
    ),
  ].join("\n");
}

export function registerRunTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_list_runs",
    {
      title: "List agent runs",
      description:
        "List agent runs for a board (newest first), with optional status/kind/token/session filters and cursor paging. A run groups a PAT batch, a single destructive PAT command or a plan apply; pre-images are not included here.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        status: z
          .enum(["applied", "reverted", "failed"])
          .optional()
          .describe("Filter by run status."),
        kind: z
          .enum(["batch", "plan", "single", "revert"])
          .optional()
          .describe("Filter by run kind."),
        apiTokenId: z.string().optional().describe("Filter by API token id."),
        agentSessionId: z
          .string()
          .optional()
          .describe("Filter by agent session id."),
        clientRunId: z
          .string()
          .optional()
          .describe("Filter by the client's idempotency key."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of runs to return (1–100)."),
        cursor: z
          .string()
          .optional()
          .describe("Run id to page after (older rows)."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({
      boardId,
      status,
      kind,
      apiTokenId,
      agentSessionId,
      clientRunId,
      limit,
      cursor,
      response_format,
    }) => {
      const runs = await client.listRuns(boardId, {
        ...(status !== undefined ? { status } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(apiTokenId !== undefined ? { apiTokenId } : {}),
        ...(agentSessionId !== undefined ? { agentSessionId } : {}),
        ...(clientRunId !== undefined ? { clientRunId } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      return respond(
        response_format,
        { runs, count: runs.length },
        renderRuns(runs),
      );
    },
  );

  defineTool(
    server,
    "janosik_get_run",
    {
      title: "Get an agent run",
      description:
        "Read one run with its commands and attribution. Pre-images and the full before-state are visible only to a board ADMIN browser session; an API token sees the run and commands without them.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        runId: z.string().describe("Run id from janosik_list_runs."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, runId, response_format }) => {
      const detail = await client.getRun(boardId, runId);
      return respond(
        response_format,
        { ...detail },
        [
          renderRun(detail.run),
          "",
          `## Commands (${detail.commands.length})`,
          ...bullets(
            detail.commands.map(
              (command) =>
                `${command.seq}: ${command.action.type} · ${code(command.commandId ?? "")}`,
            ),
          ),
        ].join("\n"),
      );
    },
  );

  defineTool(
    server,
    "janosik_preview_run_revert",
    {
      title: "Preview a run rollback",
      description:
        "Dry-run the rollback of a run: returns the conflicts and whether a board ADMIN can revert it. Writes nothing. Applying a revert is human-only — report the conflicts and ask a human to do it; no MCP tool can apply it.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        runId: z.string().describe("Run id from janosik_list_runs."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, runId, response_format }) => {
      const preview = await client.previewRunRevert(boardId, runId);
      const text = [
        `# Rollback preview ${code(runId)}`,
        `- can revert: **${preview.canRevert ? "yes" : "no"}**`,
        `- conflicts: ${preview.conflicts.length}`,
        ...(preview.conflicts.length > 0
          ? [
              "",
              ...bullets(
                preview.conflicts.map(
                  (conflict) =>
                    `${code(conflict.touch)} — ${conflict.reason} (expected ${conflict.expectedVersion}, current ${conflict.currentVersion})`,
                ),
              ),
            ]
          : []),
        "",
        "Applying a revert is a browser board-ADMIN action (no MCP tool).",
      ].join("\n");
      return respond(
        response_format,
        {
          run: preview.run,
          conflicts: preview.conflicts,
          canRevert: preview.canRevert,
          ...(preview.diff !== undefined ? { diff: preview.diff } : {}),
        },
        text,
      );
    },
  );
}
