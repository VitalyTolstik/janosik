/**
 * Approval tools (TASK-166.5): ask a human to authorize one exact plan,
 * read the queue, wait for a decision and cancel a request.
 *
 * The decision tool is deliberately absent from MCP: approval is session-only
 * on the server (`pat_forbidden`), and the human-control boundary means an
 * agent must never approve its own plan (ADR D13).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ApprovalRequestDto } from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { bullets, code, formatTimestamp, respond } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { READ, WRITE, defineTool } from "./helpers.js";

const PLAN_SCHEMA = z
  .object({
    schemaVersion: z.literal(1),
    boardId: z
      .string()
      .describe("Board id; must match the board in the route."),
    commands: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Commands for a content plan (mutually exclusive with operations).",
      ),
    operations: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Exactly one lifecycle operation (mutually exclusive with commands).",
      ),
  })
  .describe("The exact executable plan; the server computes its planHash.");

function renderApproval(approval: ApprovalRequestDto): string {
  return [
    `# Approval ${code(approval.id)}`,
    `- status: **${approval.status}**`,
    `- kind: ${approval.kind} · risk: ${approval.risk}`,
    `- action: ${approval.actionType}`,
    `- summary: ${approval.summary}`,
    `- board: ${code(approval.boardId)}${
      approval.cardId ? ` · card: ${code(approval.cardId)}` : ""
    }`,
    `- token: ${code(approval.requestedByTokenId)}`,
    `- expires: ${formatTimestamp(approval.expiresAt)}`,
    `- planHash: ${code(approval.planHash)}`,
    ...(approval.decidedAt
      ? [
          `- decided: ${formatTimestamp(approval.decidedAt)} by ${code(
            approval.decidedBy ?? "",
          )}${approval.decisionComment ? ` — ${approval.decisionComment}` : ""}`,
        ]
      : []),
    ...(approval.runId ? [`- consumed by run: ${code(approval.runId)}`] : []),
    ...(approval.plan?.commands
      ? [
          "- planned commands:",
          ...approval.plan.commands.map(
            (command) =>
              `  - ${code(command.commandId)}: ${command.action.type}`,
          ),
        ]
      : []),
    ...(approval.plan?.operations
      ? [
          "- planned operations:",
          ...approval.plan.operations.map((operation) => `  - ${operation.op}`),
        ]
      : []),
  ].join("\n");
}

function renderApprovals(approvals: ApprovalRequestDto[]): string {
  if (approvals.length === 0) return "# Approvals\n\n_(none)_";
  return [
    `# Approvals (${approvals.length})`,
    "",
    ...bullets(
      approvals.map(
        (approval) =>
          `${code(approval.id)} — **${approval.status}** · ${approval.kind} · ${approval.summary} · expires ${formatTimestamp(approval.expiresAt)}`,
      ),
    ),
  ].join("\n");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function registerApprovalTools(
  server: McpServer,
  client: JanosikClient,
) {
  defineTool(
    server,
    "janosik_request_approval",
    {
      title: "Request human approval",
      description:
        "Ask a board ADMIN to approve one exact plan. Returns the pending request with its planHash and expiry; nothing is applied. Repeat the same plan with X-Approval-Id (the approvalId argument on write tools) after a human approves it.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        kind: z
          .enum(["destructive", "done", "custom"])
          .describe("Why a human is needed: destructive, done, or custom."),
        cardId: z.string().optional().describe("Card the request is about."),
        ttlMinutes: z
          .number()
          .int()
          .min(1)
          .max(1440)
          .optional()
          .describe(
            "Requested lifetime; clamped to the board policy and 5 min.",
          ),
        plan: PLAN_SCHEMA,
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, kind, cardId, ttlMinutes, plan, response_format }) => {
      const approval = await client.requestApproval(boardId, {
        kind,
        ...(cardId !== undefined ? { cardId } : {}),
        ...(ttlMinutes !== undefined ? { ttlMinutes } : {}),
        plan: plan as never,
      });
      return respond(response_format, { approval }, renderApproval(approval));
    },
  );

  defineTool(
    server,
    "janosik_list_approvals",
    {
      title: "List approvals",
      description:
        "List approval requests for a board (newest first). A board ADMIN sees all; another token sees only its own requests.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        status: z
          .enum([
            "pending",
            "approved",
            "rejected",
            "expired",
            "cancelled",
            "consumed",
          ])
          .optional()
          .describe("Filter by status."),
        kind: z
          .enum(["destructive", "done", "custom"])
          .optional()
          .describe("Filter by kind."),
        cardId: z.string().optional().describe("Filter by card id."),
        limit: z.number().int().min(1).max(100).optional(),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, status, kind, cardId, limit, response_format }) => {
      const approvals = await client.listApprovals(boardId, {
        ...(status !== undefined ? { status } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(cardId !== undefined ? { cardId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return respond(
        response_format,
        { approvals, count: approvals.length },
        renderApprovals(approvals),
      );
    },
  );

  defineTool(
    server,
    "janosik_get_approval",
    {
      title: "Get an approval",
      description:
        "Read one approval request with its exact plan, status, expiry and decision.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        approvalId: z.string().describe("Approval id."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, approvalId, response_format }) => {
      const approval = await client.getApproval(boardId, approvalId);
      return respond(response_format, { approval }, renderApproval(approval));
    },
  );

  defineTool(
    server,
    "janosik_wait_for_decision",
    {
      title: "Wait for an approval decision",
      description:
        "Poll an approval for up to 60 seconds per call. Returns as soon as it is approved, rejected, expired or cancelled; if it is still pending, call again. Never retry the original destructive action without X-Approval-Id.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        approvalId: z.string().describe("Approval id from request_approval."),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("Maximum wait for this call (default 60, max 60)."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, approvalId, timeoutSeconds, response_format }) => {
      const deadline = Date.now() + (timeoutSeconds ?? 60) * 1000;
      let approval = await client.getApproval(boardId, approvalId);
      while (
        approval.status === "pending" &&
        Date.now() < deadline &&
        approval.expiresAt > Date.now()
      ) {
        await sleep(2000);
        approval = await client.getApproval(boardId, approvalId);
      }
      return respond(
        response_format,
        { approval, waited: approval.status !== "pending" },
        renderApproval(approval) +
          (approval.status === "pending"
            ? "\n\nStill pending. Call janosik_wait_for_decision again; do not apply the plan."
            : ""),
      );
    },
  );

  defineTool(
    server,
    "janosik_cancel_approval",
    {
      title: "Cancel an approval",
      description:
        "Cancel your own pending approval request. A cancelled request cannot be applied.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        approvalId: z.string().describe("Approval id."),
        response_format: responseFormatSchema,
      },
      annotations: WRITE,
    },
    async ({ boardId, approvalId, response_format }) => {
      const approval = await client.cancelApproval(boardId, approvalId);
      return respond(response_format, { approval }, renderApproval(approval));
    },
  );
}
