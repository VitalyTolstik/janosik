import assert from "node:assert/strict";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

const {
  LIVE_URL: url,
  LIVE_PAT: token,
  LIVE_SHARE_PAT: shareToken,
  LIVE_HUMAN: human,
  LIVE_BOARD: board,
  LIVE_CARD: card,
  LIVE_OTHER_BOARD: otherBoard,
  LIVE_OTHER_CARD: otherCard,
  LIVE_FILE: file,
} = process.env;
const server = createServer({
  url,
  token,
  appBase: "",
  allowFs: true,
  fsRoot: null,
  readOnly: false,
  toolsets: new Set(["sessions", "comments", "attachments"]),
});
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(b);
const client = new Client({ name: "live-session-test", version: "1" });
await client.connect(a);
const call = (name, args) => client.callTool({ name, arguments: args });
const ok = async (name, args) => {
  const result = await call(name, args);
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
};
const blocked = async (name, args) => {
  const result = await call(name, args);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "agent_paused");
};
const start = await ok("janosik_start_session", { boardId: board });
const sid = start.resourceId;
const other = await ok("janosik_start_session", { boardId: otherBoard });
const comment = await ok("janosik_add_comment", {
  cardId: card,
  text: "mcp attributed",
});
const attachment = await ok("janosik_upload_attachment", {
  cardId: card,
  filePath: file,
});
const http = async (path, method = "GET") => {
  const res = await globalThis.fetch(`${url}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${human}`,
      "Content-Type": "application/json",
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  assert.equal(res.ok, true, `${path}: ${res.status}`);
  return res.json();
};
const comments = await http(`/cards/${card}/comments`);
assert.equal(
  comments.items.find((item) => item.id === comment.resourceId).agentSessionId,
  sid,
);
const attachments = await http(`/cards/${card}/attachments`);
assert.equal(
  attachments.find((item) => item.id === attachment.resourceId)
    .uploadedBySessionId,
  sid,
);
await http(`/boards/${board}/agent-sessions/${sid}/pause`, "POST");
await blocked("janosik_add_comment", { cardId: card, text: "blocked" });
await blocked("janosik_delete_comment", { commentId: comment.resourceId });
await blocked("janosik_upload_attachment", { cardId: card, filePath: file });
await blocked("janosik_delete_attachment", {
  attachmentId: attachment.resourceId,
});
const otherComment = await ok("janosik_add_comment", {
  cardId: otherCard,
  text: "other board",
});
const otherComments = await http(`/cards/${otherCard}/comments`);
assert.equal(
  otherComments.items.find((item) => item.id === otherComment.resourceId)
    .agentSessionId,
  other.resourceId,
);
await http(`/boards/${board}/agent-sessions/${sid}/resume`, "POST");
await ok("janosik_delete_comment", { commentId: comment.resourceId });
await ok("janosik_delete_attachment", { attachmentId: attachment.resourceId });
await ok("janosik_add_comment", { cardId: card, text: "resumed" });
await ok("janosik_upload_attachment", { cardId: card, filePath: file });
await client.close();

const shareServer = createServer({
  url,
  token: shareToken,
  appBase: "",
  allowFs: false,
  fsRoot: null,
  readOnly: false,
  toolsets: new Set(["shares"]),
});
const [shareClientTransport, shareServerTransport] =
  InMemoryTransport.createLinkedPair();
await shareServer.connect(shareServerTransport);
const shareClient = new Client({ name: "live-share-test", version: "1" });
await shareClient.connect(shareClientTransport);
const shareArgs = {
  boardId: board,
  mode: "live",
  expiresInHours: 1,
  idempotencyKey: "live-share-idempotency",
};
const first = await shareClient.callTool({
  name: "janosik_create_share",
  arguments: shareArgs,
});
const replay = await shareClient.callTool({
  name: "janosik_create_share",
  arguments: shareArgs,
});
assert.equal(first.isError, undefined);
assert.equal(
  replay.structuredContent.resourceId,
  first.structuredContent.resourceId,
);
const conflict = await shareClient.callTool({
  name: "janosik_create_share",
  arguments: { ...shareArgs, expiresInHours: 2 },
});
assert.equal(conflict.isError, true);
assert.equal(conflict.structuredContent.code, "idempotency_conflict");
await shareClient.close();
