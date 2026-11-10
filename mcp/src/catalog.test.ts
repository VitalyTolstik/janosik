import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { TOOLSETS } from "./config.js";
import { createServer } from "./server.js";

/**
 * Catalog and documentation invariants for the MCP server. The exact tool
 * count is pinned separately in `server.test.ts`; this file keeps the quality
 * bar of every tool and the README catalog in sync with the registered set.
 */

interface RegisteredTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema?: {
    properties?: Record<string, { description?: string }>;
  };
}

async function allTools(): Promise<RegisteredTool[]> {
  const server = createServer({
    url: "http://api.test",
    token: "jnk_test",
    appBase: "",
    allowFs: false,
    fsRoot: null,
    toolsets: new Set(TOOLSETS),
    readOnly: false,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "catalog-audit", version: "0.0.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools as RegisteredTool[];
}

function documentedTools(): string[] {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("## Tools");
  const end = readme.indexOf("## Common flows");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("README tool catalog section is missing");
  }
  return [...new Set(readme.slice(start, end).match(/janosik_[a-z0-9_]+/g))];
}

/** Read-only tools by naming convention, plus the non-obvious reads. */
function shouldBeReadOnly(name: string): boolean {
  return (
    /^janosik_(get_|list_|search_|preview_|wait_|whoami$)/.test(name) ||
    name === "janosik_plan_changes" ||
    name.endsWith("_activity")
  );
}

describe("MCP tool catalog", () => {
  it("documents exactly the registered tools in mcp/README.md", async () => {
    const registered = (await allTools()).map((tool) => tool.name).sort();
    const documented = documentedTools().sort();
    expect(documented).toEqual(registered);
  });

  it("gives every tool a title, description and complete annotations", async () => {
    for (const tool of await allTools()) {
      const title = tool.title;
      const description = tool.description;
      expect(title?.trim(), `${tool.name}: title`).toBeTruthy();
      expect(title!.length, `${tool.name}: title length`).toBeGreaterThan(3);
      expect(description?.trim(), `${tool.name}: description`).toBeTruthy();
      expect(
        description!.length,
        `${tool.name}: description length`,
      ).toBeGreaterThan(15);
      expect(tool.annotations, `${tool.name}: annotations`).toBeDefined();
      for (const hint of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name}: ${hint}`).toBe(
          "boolean",
        );
      }
    }
  });

  it("describes every input parameter", async () => {
    const visit = (schema: unknown, path: string) => {
      if (Array.isArray(schema)) {
        schema.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      if (schema === null || typeof schema !== "object") return;
      const node = schema as {
        properties?: Record<string, unknown>;
        items?: unknown;
        allOf?: unknown[];
        anyOf?: unknown[];
        oneOf?: unknown[];
      };
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        const childNode = child as
          | { description?: string; const?: unknown; enum?: unknown[] }
          | undefined;
        if (childNode?.const === undefined && childNode?.enum?.length !== 1) {
          expect(
            childNode?.description?.trim(),
            `${path}.${name}: parameter description`,
          ).toBeTruthy();
        }
        visit(child, `${path}.${name}`);
      }
      if (node.items !== undefined) visit(node.items, `${path}[]`);
      if (Array.isArray(node.allOf)) {
        node.allOf.forEach((item, index) =>
          visit(item, `${path}.allOf[${index}]`),
        );
      }
    };

    for (const tool of await allTools()) {
      visit(tool.inputSchema, tool.name);
    }
  });

  it("keeps read/write/destructive annotations aligned with the name", async () => {
    for (const tool of await allTools()) {
      const annotations = tool.annotations!;
      if (shouldBeReadOnly(tool.name)) {
        expect(annotations.readOnlyHint, `${tool.name}: readOnlyHint`).toBe(
          true,
        );
      }
      if (annotations.readOnlyHint) {
        expect(
          annotations.destructiveHint,
          `${tool.name}: a read-only tool cannot be destructive`,
        ).toBe(false);
      }
      if (annotations.destructiveHint) {
        expect(
          annotations.readOnlyHint,
          `${tool.name}: a destructive tool cannot be read-only`,
        ).toBe(false);
      }
    }

    const tools = await allTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations!]));
    // The documented exceptions: archive/release/link removal are reversible,
    // while a plan may delete content and must advertise that.
    for (const name of [
      "janosik_archive_card",
      "janosik_unarchive_card",
      "janosik_archive_board",
      "janosik_unarchive_board",
      "janosik_release_card",
      "janosik_remove_card_link",
      "janosik_cancel_approval",
    ]) {
      expect(byName.get(name)?.destructiveHint, name).toBe(false);
    }
    expect(byName.get("janosik_apply_plan")?.destructiveHint).toBe(true);
    for (const name of [
      "janosik_delete_card",
      "janosik_delete_column",
      "janosik_clear_column",
      "janosik_delete_label",
      "janosik_delete_checklist",
      "janosik_delete_checklist_item",
      "janosik_delete_board",
      "janosik_delete_comment",
      "janosik_delete_attachment",
      "janosik_remove_member",
      "janosik_revoke_share",
    ]) {
      expect(byName.get(name)?.destructiveHint, name).toBe(true);
    }
  });

  it("does not document removed account/invitation tools", () => {
    const documented = documentedTools();
    for (const removed of [
      "janosik_update_profile",
      "janosik_list_invitations",
      "janosik_accept_invitation",
      "janosik_decline_invitation",
      "janosik_revert_run",
      "janosik_apply_run_revert",
      "janosik_decide_approval",
    ]) {
      expect(documented).not.toContain(removed);
    }
  });
});
