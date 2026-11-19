import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

const {
  LIVE_URL: url,
  LIVE_PAT: token,
  LIVE_HUMAN: human,
  LIVE_BOARD: boardId,
} = process.env;
const server = createServer({
  url,
  token,
  appBase: "",
  allowFs: false,
  fsRoot: null,
  readOnly: false,
  toolsets: new Set(["columns", "cards", "approvals", "plans"]),
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "live-approval-test", version: "1" });
await client.connect(clientTransport);

async function call(name, args, expectedError) {
  const result = await client.callTool({
    name: `janosik_${name}`,
    arguments: { boardId, ...args },
  });
  if (expectedError) {
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.equal(result.structuredContent.code, expectedError);
  } else {
    assert.equal(result.isError, undefined, JSON.stringify(result));
  }
  return result.structuredContent;
}

async function http(path = "", body) {
  const response = await globalThis.fetch(
    `${url}/api/v1/boards/${boardId}${path}`,
    {
      headers: {
        Authorization: `Bearer ${human}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    },
  );
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${await response.clone().text()}`,
  );
  return response.json();
}

async function approve(tool, args) {
  const { approvalId } = await call(tool, args, "approval_required");
  const { approval } = await call("get_approval", {
    approvalId,
    response_format: "json",
  });
  assert.equal(approval.status, "pending");
  const [command] = approval.plan.commands;
  assert.ok(command.commandId);
  await http(`/approvals/${approvalId}/decision`, {
    decision: "approve",
    planHash: approval.planHash,
  });
  return { approvalId, commandId: command.commandId, approval };
}

async function humanCommand(action) {
  return http("/commands", {
    commandId: randomUUID(),
    action: { ...action, boardId, at: Date.now() },
  });
}

try {
  const columnId = randomUUID();
  await humanCommand({
    type: "ADD_COLUMN",
    newColumnId: columnId,
    title: "Clear twice",
  });
  const addCard = async (title) => {
    const id = randomUUID();
    await humanCommand({ type: "ADD_CARD", newCardId: id, columnId, title });
    return id;
  };
  const firstCard = await addCard("First clear");
  const first = await approve("clear_column", { columnId });
  const mismatch = await call(
    "clear_column",
    {
      columnId,
      approvalId: first.approvalId,
    },
    "approval_mismatch",
  );
  assert.equal(mismatch.planHash, first.approval.planHash);
  assert.deepEqual(mismatch.plan, first.approval.plan);
  const firstArgs = {
    columnId,
    commandId: first.commandId,
    approvalId: first.approvalId,
  };
  await call("clear_column", firstArgs);
  assert.ok((await http()).cards[firstCard].archivedAt);

  const secondCard = await addCard("Second clear");
  await call("clear_column", firstArgs);
  assert.ok(
    (await http()).columns
      .find((column) => column.id === columnId)
      .cardIds.includes(secondCard),
  );
  const second = await approve("clear_column", { columnId });
  assert.notEqual(second.commandId, first.commandId);
  assert.notEqual(second.approvalId, first.approvalId);
  await call("apply_plan", {
    approvalId: second.approvalId,
    planHash: second.approval.planHash,
    commands: second.approval.plan.commands,
  });
  const after = await http();
  assert.deepEqual(
    after.columns.find((column) => column.id === columnId).cardIds,
    [],
  );
  assert.ok(after.cards[secondCard].archivedAt);

  const cardId = await addCard("Restore and delete");
  const snapshot = (await http()).cards[cardId];
  const deletion = await approve("delete_card", { cardId });
  await call("delete_card", {
    cardId,
    commandId: deletion.commandId,
    approvalId: deletion.approvalId,
  });
  assert.equal((await http()).cards[cardId], undefined);
  await humanCommand({
    type: "RESTORE_CARD",
    card: snapshot,
    columnId,
    index: 0,
  });
  assert.equal((await http()).cards[cardId].title, snapshot.title);
  const repeatDeletion = await approve("delete_card", { cardId });
  assert.notEqual(repeatDeletion.commandId, deletion.commandId);
  await call("delete_card", {
    cardId,
    commandId: repeatDeletion.commandId,
    approvalId: repeatDeletion.approvalId,
  });
  assert.equal((await http()).cards[cardId], undefined);
} finally {
  await client.close();
  await server.close();
}
