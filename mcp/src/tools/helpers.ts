/**
 * Registration helpers shared by every tool group: one place that turns a
 * thrown error into an actionable result and one that registers a tool with
 * the SDK's generic signature kept out of the way.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

import { describeError } from "../errors.js";
import { errorResult, type ToolResult } from "../format.js";

/** Behaviour hints the MCP spec exposes to clients (advisory, not security). */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** Reads: no side effects, repeatable. */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Additive writes: change state but never remove anything. */
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Destructive writes: delete or overwrite content. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Servers built in read-only mode: write tools are not registered at all. */
const readOnlyServers = new WeakSet<McpServer>();

/** Register only `readOnlyHint` tools on this server from now on. */
export function restrictToReadOnly(server: McpServer): void {
  readOnlyServers.add(server);
}

interface ToolConfig<S extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
}

/**
 * Register one tool. The handler's thrown errors become `isError` results
 * carrying an actionable message; the SDK's generic `registerTool` signature
 * is applied through a narrow cast so callers stay readable.
 */
export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<S>,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
): void {
  if (readOnlyServers.has(server) && !config.annotations.readOnlyHint) return;
  const wrapped = async (
    args: z.infer<z.ZodObject<S>>,
  ): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(describeError(error));
    }
  };
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    cb: unknown,
  ) => unknown;
  register(name, config, wrapped);
}
