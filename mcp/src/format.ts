/**
 * Tool response formatting. Every data-returning tool supports two formats:
 * `markdown` (default, human-readable, token-frugal) and `json`
 * (machine-readable, full field set), and always attaches the structured
 * object so a client can process it without re-parsing the text.
 */

import { CHARACTER_LIMIT } from "./constants.js";

export const RESPONSE_FORMATS = ["markdown", "json"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

export interface TextContent {
  type: "text";
  text: string;
}

/** The shape `registerTool` expects back from a handler. */
export interface ToolResult {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** A data response: JSON text for `json`, the rendered text otherwise. */
export function respond(
  format: ResponseFormat,
  json: Record<string, unknown>,
  markdown: string,
  narrowHint = "Narrow the query (fewer cards, a smaller page).",
): ToolResult {
  const jsonText = JSON.stringify(json, null, 2);
  // Only attach structured content when it fits the budget; otherwise an
  // unbounded payload would flood the agent's context.
  const oversized = jsonText.length > CHARACTER_LIMIT;
  if (format === "json" && oversized) {
    // Half a JSON document is worse than none: it does not parse, and an
    // agent may act on the part it got. Refuse and say how to narrow.
    return errorResult(
      `Error: the JSON response would be ${jsonText.length} characters, over ` +
        `the ${CHARACTER_LIMIT}-character limit. ${narrowHint}`,
      {
        ok: false,
        code: "payload_too_large",
        retryable: false,
        limit: CHARACTER_LIMIT,
      },
    );
  }
  return {
    content: [
      { type: "text", text: format === "json" ? jsonText : cap(markdown) },
    ],
    ...(oversized ? {} : { structuredContent: json }),
  };
}

/** Extra fields a mutation may return to an agent (ADR §8.5, TASK-166.4). */
export interface MutationStructuredContent {
  resourceId?: string | null;
  seq?: number;
  runId?: string | null;
  approvalId?: string | null;
  [key: string]: unknown;
}

/**
 * A confirmation response for a mutation. It always carries
 * `structuredContent: { ok: true, … }` (TASK-166.4), so an MCP client can
 * read the resource id/seq without parsing the human sentence. The text
 * stays for people.
 */
export function textOnly(
  text: string,
  structured: MutationStructuredContent = {},
): ToolResult {
  return {
    content: [{ type: "text", text: cap(text) }],
    structuredContent: { ok: true, ...structured },
  };
}

/** An error response — the message must already be actionable. */
export function errorResult(
  message: string,
  structured: Record<string, unknown> = {
    ok: false,
    code: "validation_failed",
    retryable: false,
  },
): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: structured,
  };
}

/** Clamp a response to the character budget with a visible note. */
export function cap(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n… response truncated at ${CHARACTER_LIMIT} characters. ` +
    "Narrow the query (fewer cards, a smaller page) to see the rest."
  );
}

/** `2026-10-27 14:05` in UTC, from Unix ms (a stable, unambiguous stamp). */
export function formatTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 16);
}

/** A short bullet list, or a placeholder when empty. */
export function bullets(items: string[], empty = "_(none)_"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : empty;
}

/** Inline `code` for an id, for readable markdown lines. */
export function code(value: string): string {
  return `\`${value}\``;
}
