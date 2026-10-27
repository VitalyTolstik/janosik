import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Live smoke test against a running instance. Build first, then:
 *   JANOSIK_URL=http://localhost:3210 JANOSIK_TOKEN=jnk_… node scripts/smoke.mjs
 */
const url = process.env.JANOSIK_URL;
const token = process.env.JANOSIK_TOKEN;
if (!url || !token) throw new Error("JANOSIK_URL / JANOSIK_TOKEN required");

const serverEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  // Every group, so the catalog count below covers the whole surface.
  env: {
    ...process.env,
    JANOSIK_URL: url,
    JANOSIK_TOKEN: token,
    JANOSIK_MCP_TOOLSETS: "all",
  },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const log = (label, ok, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);

const { tools } = await client.listTools();
log(`listTools (${tools.length} tools)`, tools.length === 68);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    const text = res.content.map((c) => c.text).join("\n");
    throw new Error(`${name} failed: ${text}`);
  }
  return res;
};
const json = (res) => res.structuredContent;

// Read path.
const boards = json(
  await call("janosik_list_boards", { response_format: "json" }),
);
log("janosik_list_boards", Array.isArray(boards.boards));

// Full write path on a throwaway board.
const created = json(
  await call("janosik_create_board", {
    title: "MCP smoke",
    response_format: "json",
  }),
);
const boardId = created.board.id;
log("janosik_create_board", Boolean(boardId), boardId);

await call("janosik_create_column", { boardId, title: "Todo" });
const board = json(
  await call("janosik_get_board", { boardId, response_format: "json" }),
).board;
const columnId = board.columns[0].id;
log("janosik_create_column", board.columns.length === 1);

const cardRes = await call("janosik_create_card", {
  boardId,
  columnId,
  title: "Write the docs",
  description: "Body **bold**",
  priority: "high",
});
const cardId = /`([0-9a-f-]{36})`/.exec(cardRes.content[0].text)[1];
log("janosik_create_card", Boolean(cardId), cardId);

const afterCard = json(
  await call("janosik_get_card", { boardId, cardId, response_format: "json" }),
);
log(
  "janosik_get_card",
  afterCard.card.priority === "high" && afterCard.columnId === columnId,
);

await call("janosik_add_checklist", { boardId, cardId, title: "Steps" });
const withList = json(
  await call("janosik_get_card", { boardId, cardId, response_format: "json" }),
);
const checklistId = withList.card.checklists[0].id;
await call("janosik_add_checklist_item", {
  boardId,
  cardId,
  checklistId,
  text: "First",
});
const withItem = json(
  await call("janosik_get_card", { boardId, cardId, response_format: "json" }),
);
const itemId = withItem.card.checklists[0].items[0].id;
await call("janosik_set_checklist_item_done", {
  boardId,
  cardId,
  checklistId,
  itemId,
  done: true,
});
const ticked = json(
  await call("janosik_get_card", { boardId, cardId, response_format: "json" }),
);
log("janosik_checklist flow", ticked.card.checklists[0].items[0].done === true);

await call("janosik_add_comment", { cardId, text: "On it." });
const comments = json(
  await call("janosik_list_comments", { cardId, response_format: "json" }),
);
log("janosik_add_comment + list", comments.comments.length === 1);

const activity = json(
  await call("janosik_board_activity", { boardId, response_format: "json" }),
);
log(
  "janosik_board_activity",
  activity.activity.length > 0,
  `${activity.activity.length} entries`,
);

const search = json(
  await call("janosik_search_cards", {
    boardId,
    query: "docs",
    response_format: "json",
  }),
);
log("janosik_search_cards", search.results.length === 1);

const err = await client.callTool({
  name: "janosik_get_card",
  arguments: { boardId, cardId: "nope" },
});
log(
  "unknown card -> graceful message",
  err.content[0].text.includes("not on board"),
);

// A wrong token must be rejected with an actionable error, not a crash.
const badTransport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: {
    ...process.env,
    JANOSIK_URL: url,
    JANOSIK_TOKEN: "jnk_definitely_not_a_real_token",
  },
});
const badClient = new Client({ name: "smoke-bad", version: "0.0.0" });
await badClient.connect(badTransport);
const badAuth = await badClient.callTool({
  name: "janosik_list_boards",
  arguments: {},
});
const badText = badAuth.content.map((c) => c.text).join(" ");
log(
  "invalid token -> actionable error",
  badAuth.isError === true && /authenticated|token/i.test(badText),
  badText.slice(0, 80),
);
await badClient.close();

await call("janosik_delete_board", { boardId });
log("janosik_delete_board", true);

await client.close();
console.log("DONE");
