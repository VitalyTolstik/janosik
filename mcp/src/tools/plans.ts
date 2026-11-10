/**
 * Plan tools (TASK-166.8): preview a multi-step edit as a dry-run, then apply
 * the exact previewed commands atomically.
 *
 * The two tools are deliberately paired: `plan_changes` returns a canonical
 * `planHash` and the normalized plan; `apply_plan` refuses a hash that does
 * not match the submitted commands. An agent must echo both back unchanged.
 * A destructive plan answers `approval_required` until a human approves the
 * same hash; `approvalId` is then passed as `X-Approval-Id`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type {
  PlanApplyResponse,
  PlanCommandRequest,
  PlanPreviewDto,
} from "@janosik/shared";
import type { JanosikClient } from "../client.js";
import { bullets, code, respond, textOnly } from "../format.js";
import { responseFormatSchema } from "../schemas.js";
import { READ, WRITE, defineTool } from "./helpers.js";

/**
 * One plan command. It is the wire `CommandRequest` minus `at`/`boardId`:
 * those are server context and the plan hash deliberately excludes them.
 */
const PLAN_COMMAND_SCHEMA = z
  .object({
    commandId: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "Idempotency key for this exact command. Reuse the value from the preview.",
      ),
    action: z
      .record(z.string(), z.unknown())
      .describe(
        'The BoardAction payload, including "type" (ADD_CARD, UPDATE_CARD, …).',
      ),
    ifMatch: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Expected board seq at this command's point in the plan."),
    ifMatchVersions: z
      .record(z.string(), z.number().int().min(0))
      .optional()
      .describe("Per-entity version preconditions (card:<id>, …)."),
  })
  .describe("One command of the plan.");

function renderPreview(preview: PlanPreviewDto): string {
  return [
    `# Plan preview ${code(preview.boardId)}`,
    `- dry run: **yes** · writes nothing, creates no run`,
    `- commands: ${preview.commandCount} · card creates: ${preview.cardCreates}`,
    `- limits: ${preview.limits.commands} commands · ${preview.limits.cards} card creates`,
    `- planHash: ${code(preview.planHash)}`,
    `- requirement: ${preview.requirement.kind} · scope ${preview.requirement.requiredScope} · risk ${preview.requirement.risk}`,
    `- approval required: **${preview.requirement.requiresApproval ? "yes" : "no"}**`,
    `- can apply: **${preview.canApply ? "yes" : "no"}**`,
    "",
    `## Conflicts (${preview.conflicts.length})`,
    ...bullets(
      preview.conflicts.map(
        (conflict) =>
          `${conflict.index !== undefined ? `#${conflict.index} ` : ""}${conflict.code} — ${conflict.message}`,
      ),
    ),
    "",
    `## Warnings (${preview.warnings.length})`,
    ...bullets(
      preview.warnings.map(
        (warning) =>
          `${warning.index !== undefined ? `#${warning.index} ` : ""}${warning.code} — ${warning.message}`,
      ),
    ),
    "",
    `## Changes (${preview.diff.length})`,
    ...bullets(
      preview.diff.map((change) =>
        change.kind === "update" && change.fields
          ? `${code(change.touch)} — update: ${change.fields.join(", ")}`
          : `${code(change.touch)} — ${change.kind}`,
      ),
    ),
    "",
    "Apply with janosik_apply_plan using exactly these commands and this planHash.",
  ].join("\n");
}

function renderApplied(result: PlanApplyResponse): string {
  return [
    `# Plan applied`,
    `- planHash: ${code(result.planHash)}`,
    `- run: ${result.runId ? code(result.runId) : "_(no run — browser apply)_"}`,
    `- commands: ${result.results.length}`,
    "",
    ...bullets(
      result.results.map(
        (response, index) => `#${index} — seq ${response.seq}`,
      ),
    ),
  ].join("\n");
}

export function registerPlanTools(server: McpServer, client: JanosikClient) {
  defineTool(
    server,
    "janosik_plan_changes",
    {
      title: "Preview a plan (dry run)",
      description:
        "Dry-run a multi-step or bulk edit: validates every command with the same rules as /commands/batch, replays the board reducer in memory and returns the canonical planHash, a before/after diff, warnings and conflicts. Writes nothing and creates no run. Bulk work goes through this pair; 50 card creates = up to 100 commands, the per-plan limit. Pass the returned commands and planHash unchanged to janosik_apply_plan.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        commands: z
          .array(PLAN_COMMAND_SCHEMA)
          .min(1)
          .max(1_000)
          .describe("Commands in application order."),
        clientRunId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,64}$/)
          .optional()
          .describe("Idempotency key for the run created on apply."),
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ boardId, commands, clientRunId, response_format }) => {
      const preview = await client.planChanges(boardId, {
        // The zod record is the wire shape; the server validates the action.
        commands: commands as PlanCommandRequest[],
        ...(clientRunId !== undefined ? { clientRunId } : {}),
      });
      return respond(response_format, { ...preview }, renderPreview(preview));
    },
  );

  defineTool(
    server,
    "janosik_apply_plan",
    {
      title: "Apply a previewed plan",
      description:
        "Apply exactly the commands and planHash returned by janosik_plan_changes, atomically in one board transaction. A changed plan gets 409 approval_mismatch; a destructive plan without approval gets 409 approval_required with an approvalId — wait for a human, then repeat the identical call with that approvalId. An AgentRun (kind plan) groups the applied commands and can be inspected or reverted by a human.",
      inputSchema: {
        boardId: z.string().describe("Board id."),
        planHash: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .describe("planHash from janosik_plan_changes."),
        commands: z
          .array(PLAN_COMMAND_SCHEMA)
          .min(1)
          .max(1_000)
          .describe("The exact commands from the preview, unchanged."),
        approvalId: z
          .string()
          .optional()
          .describe(
            "Approved request id; sent as X-Approval-Id. Required to apply a destructive plan.",
          ),
        clientRunId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,64}$/)
          .optional()
          .describe("The same run idempotency key used in the preview."),
      },
      annotations: WRITE,
    },
    async ({ boardId, planHash, commands, approvalId, clientRunId }) => {
      const result = await client.applyPlan(
        boardId,
        {
          planHash,
          commands: commands as PlanCommandRequest[],
          ...(clientRunId !== undefined ? { clientRunId } : {}),
        },
        approvalId,
      );
      return textOnly(renderApplied(result), {
        runId: result.runId ?? null,
        planHash: result.planHash,
        commandCount: result.results.length,
        results: result.results,
      });
    },
  );
}
