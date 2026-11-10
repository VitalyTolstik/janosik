/**
 * Agent-session tools (TASK-166.1): start/heartbeat/end.
 *
 * Starting a session attaches its id to every later request from this client
 * (`X-Agent-Session`), so a PAT's commands, comments and attachments are
 * attributed to the exact token + session without the agent repeating it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgentSessionDto } from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { formatTimestamp, respond } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { WRITE, defineTool } from "./helpers.js";

function renderSession(session: AgentSessionDto): string {
  return [
    `# Agent session \`${session.id}\``,
    `- board: \`${session.boardId}\``,
    `- status: ${session.status}${session.stale ? " (stale)" : ""}${
      session.paused ? ` (paused: ${session.pauseScope ?? "unknown"})` : ""
    }`,
    `- started: ${formatTimestamp(session.startedAt)}`,
    `- last heartbeat: ${formatTimestamp(session.lastHeartbeatAt)}`,
    ...(session.name ? [`- name: ${session.name}`] : []),
    ...(session.clientName ? [`- client: ${session.clientName}`] : []),
    ...(session.model ? [`- model: ${session.model}`] : []),
    ...(session.endedAt
      ? [
          `- ended: ${formatTimestamp(session.endedAt)} (${session.endReason ?? "ended"})`,
        ]
      : []),
  ].join("\n");
}

export function registerSessionTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_start_session",
    {
      title: "Start an agent session",
      description:
        "Open a board-scoped session for this API token. The session id is sent as X-Agent-Session on later writes, attributing them to this agent run.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        name: z
          .string()
          .max(100)
          .optional()
          .describe("Human-readable session name."),
        clientName: z
          .string()
          .max(100)
          .optional()
          .describe("Client/agent product name."),
        model: z.string().max(100).optional().describe("Model identifier."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, name, clientName, model, response_format }) => {
      const session = await client.startSession(boardId, {
        ...(name !== undefined ? { name } : {}),
        ...(clientName !== undefined ? { clientName } : {}),
        ...(model !== undefined ? { model } : {}),
      });
      return respond(
        response_format,
        { session, ok: true, resourceId: session.id },
        renderSession(session),
      );
    },
  );

  defineTool(
    server,
    "janosik_heartbeat",
    {
      title: "Heartbeat an agent session",
      description:
        "Refresh the session heartbeat (and optionally status/current card/summary). Allowed while the session is paused.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        sessionId: z.string().describe("Session id returned by start_session."),
        status: z
          .enum(["active", "idle", "waiting_approval"])
          .optional()
          .describe("New non-terminal session status."),
        currentCardId: z
          .string()
          .nullable()
          .optional()
          .describe("Card the agent is working on, or null to clear."),
        summary: z
          .string()
          .max(2000)
          .optional()
          .describe("Short progress summary."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({
      boardId,
      sessionId,
      status,
      currentCardId,
      summary,
      response_format,
    }) => {
      const session = await client.heartbeat(boardId, sessionId, {
        ...(status !== undefined ? { status } : {}),
        ...(currentCardId !== undefined ? { currentCardId } : {}),
        ...(summary !== undefined ? { summary } : {}),
      });
      return respond(
        response_format,
        { session, ok: true, resourceId: session.id },
        renderSession(session),
      );
    },
  );

  defineTool(
    server,
    "janosik_end_session",
    {
      title: "End an agent session",
      description:
        "Close the session (completed, failed or cancelled). Claims held by this session are released; the token keeps working.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        sessionId: z.string().describe("Session id returned by start_session."),
        status: z
          .enum(["completed", "failed", "cancelled"])
          .optional()
          .describe("Terminal status (default completed)."),
        summary: z.string().max(2000).optional().describe("Final summary."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, sessionId, status, summary, response_format }) => {
      const session = await client.endSession(boardId, sessionId, {
        ...(status !== undefined ? { status } : {}),
        ...(summary !== undefined ? { summary } : {}),
      });
      return respond(
        response_format,
        { session, ok: true, resourceId: session.id },
        renderSession(session),
      );
    },
  );
}
