import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const {
  LIVE_URL: url,
  LIVE_PAT: token,
  LIVE_HUMAN: human,
  LIVE_BOARD: boardId,
} = process.env;
const directory = await mkdtemp(path.join(tmpdir(), "janosik-mcp-detail-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--import",
    "tsx",
    fileURLToPath(new URL("../src/index.ts", import.meta.url)),
  ],
  env: {
    JANOSIK_URL: url,
    JANOSIK_TOKEN: token,
    JANOSIK_MCP_TOOLSETS: "columns,cards,approvals,plans,runs",
    JANOSIK_MCP_ALLOW_FS: "1",
    JANOSIK_MCP_FS_ROOT: directory,
  },
});
const client = new Client({ name: "live-approval-test", version: "1" });

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

async function http(path = "", body, credential = human) {
  const response = await globalThis.fetch(
    `${url}/api/v1/boards/${boardId}${path}`,
    {
      headers: {
        Authorization: `Bearer ${credential}`,
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

async function checkLargeDocument(tool, args, expected) {
  const response_format = "json";
  await call(tool, { ...args, response_format }, "payload_too_large");
  const outputPath = `${tool}.json`;
  const saved = await call(tool, { ...args, response_format, outputPath });
  assert.deepEqual(saved, {
    ok: true,
    outputPath: path.join(directory, outputPath),
  });
  const contents = await readFile(saved.outputPath, "utf8");
  assert.ok(contents.length > 25_000);
  assert.deepEqual(JSON.parse(contents), expected);
}

try {
  await client.connect(transport);
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
  const deleted = await call("delete_card", {
    cardId,
    commandId: deletion.commandId,
    approvalId: deletion.approvalId,
  });
  assert.equal((await http()).cards[cardId], undefined);
  const deletionRun = await http(`/runs/${deleted.runId}`, undefined, token);
  assert.equal(deletionRun.run.id, deleted.runId);
  assert.equal(deletionRun.commands[0].seq, deleted.seq);
  assert.equal(deletionRun.commands[0].action.type, "DELETE_CARD");
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

  const description = "Large card — 🗂️\n".repeat(2_000).trimEnd();
  const created = await call("create_card", {
    columnId,
    cardId: randomUUID(),
    title: "Large card",
    description,
  });
  const largeCardId = created.resourceId;
  const board = await http("", undefined, token);
  assert.equal(board.cards[largeCardId].description, description);
  await checkLargeDocument(
    "get_card",
    { cardId: largeCardId },
    {
      card: board.cards[largeCardId],
      columnId,
      columnTitle: "Clear twice",
    },
  );

  const duplicateFile = await client.callTool({
    name: "janosik_get_card",
    arguments: { boardId, cardId: largeCardId, outputPath: "get_card.json" },
  });
  assert.equal(duplicateFile.isError, true);
  assert.match(duplicateFile.content[0].text, /already exists/);

  const runId = created.runId;
  const batchRun = await http(`/runs/${runId}`, undefined, token);
  assert.equal(batchRun.run.kind, "batch");
  assert.equal(batchRun.commands.length, 2);
  assert.equal(batchRun.commands[1].seq, created.seq);
  await checkLargeDocument("get_run", { runId }, batchRun);

  const plan = {
    schemaVersion: 1,
    boardId,
    commands: [
      {
        commandId: randomUUID(),
        action: { type: "UPDATE_CARD", cardId: largeCardId, description },
      },
    ],
  };
  const request = await http("/approvals", { kind: "custom", plan }, token);
  const approvalId = request.id;
  const approval = await http(`/approvals/${approvalId}`, undefined, token);
  assert.equal(approval.plan.commands[0].action.description, description);
  await checkLargeDocument("get_approval", { approvalId }, { approval });

  const updated = await call("update_card", {
    cardId: largeCardId,
    expectedDescription: description,
    expectedVersion: created.seq,
    title: "Edited large card",
  });
  assert.deepEqual(updated, { ok: true, seq: created.seq + 1, runId: null });
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
