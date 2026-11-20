#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";

export const PRESETS = {
  small: { cards: 250, boards: 5 },
  gate: { cards: 5_000, boards: 20 },
  full: { cards: 25_000, boards: 100 },
};

export function perfDataset(preset) {
  const { cards, boards } = PRESETS[preset];
  return {
    cards,
    boards,
    columns: boards * 5,
    labels: boards * 2,
    users: Math.max(20, boards * 5),
    admins: 10,
    comments: cards * 2,
    attachments: (cards * 2) / 5,
    commands: (cards * 2) / 5,
    cardLinks: (cards * 2) / 5,
    activity: (cards * 2) / 5,
    audit: cards,
  };
}

export function perfId(preset, model, index) {
  return `perf181-${preset}-${model}-${index}`;
}

export function perfDatabase() {
  const datasourceUrl = process.env.ADMIN_FILTER_PERF_DATABASE_URL;
  if (!datasourceUrl) {
    throw new Error(
      "Set ADMIN_FILTER_PERF_DATABASE_URL to a dedicated, migrated PostgreSQL database.",
    );
  }
  return new PrismaClient({ datasourceUrl });
}

async function insert(model, count, makeRow) {
  const batchSize = 1_000;
  for (let offset = 0; offset < count; offset += batchSize) {
    const length = Math.min(batchSize, count - offset);
    await model.createMany({
      data: Array.from({ length }, (_, index) => makeRow(offset + index)),
      skipDuplicates: true,
    });
  }
}

async function seed(db, preset) {
  const size = perfDataset(preset);
  const id = (model, index) => perfId(preset, model, index);
  const foreignCards = await db.card.count({
    where: { NOT: { id: { startsWith: id("card", "") } } },
  });
  if (foreignCards > 0) {
    throw new Error(
      "Use a separate benchmark database per preset. Existing cards from another dataset were found.",
    );
  }
  const now = new Date();
  const recent = (i) => new Date(now.getTime() - i * 90_000);
  const due = (i) => new Date(now.getTime() + ((i % 144) - 72) * 3_600_000);
  const priorities = [
    null,
    "medium",
    "low",
    "lowest",
    "high",
    "highest",
    "blocker",
  ];
  const kinds = [
    "note",
    "status",
    "question",
    "blocker",
    "evidence",
    "handoff",
  ];
  const mimeTypes = [
    "application/pdf",
    "image/png",
    "video/mp4",
    "audio/ogg",
    "text/csv",
    "application/zip",
  ];
  const auditActions = [
    "board.command",
    "board.created",
    "user.updated",
    "attachment.deleted",
    "token.revoked",
  ];
  const targetTypes = ["card", "board", "user", "attachment", "token"];
  const user = (i) => id("user", i % size.users);
  const card = (i) => id("card", i % size.cards);
  const boardIndex = (i) => i % size.boards;

  // Match the five-column board topology of the 25K baseline, with the admin
  // workloads layered on so exact counts and relation predicates are exercised.
  await insert(db.user, size.users, (i) => ({
    id: user(i),
    email: `${user(i)}@example.invalid`,
    displayName: `Perf user ${i}`,
    createdAt: recent(i),
    emailVerifiedAt: i % 5 ? recent(i) : null,
  }));
  await insert(db.adminUser, size.admins, (i) => ({
    id: id("actor", i),
    email: `${id("actor", i)}@example.invalid`,
    passwordHash: "benchmark-fixture",
    role: i === 0 ? "OWNER" : "OPERATOR",
  }));
  await insert(db.board, size.boards, (i) => ({
    id: id("board", i),
    title: `Benchmark board ${i % 20}`,
    updatedAt: recent(i),
  }));
  await insert(db.boardMember, size.boards * 3, (i) => ({
    id: id("member", i),
    boardId: id("board", boardIndex(i)),
    userId: user(i),
    role: i < size.boards * 2 ? "ADMIN" : "MEMBER",
    acceptedAt: recent(i),
  }));
  await insert(db.column, size.columns, (i) => ({
    id: id("column", i),
    boardId: id("board", boardIndex(i)),
    title: ["Backlog", "Ready", "In progress", "Review", "Done"][
      Math.floor(i / size.boards)
    ],
    position: Math.floor(i / size.boards),
  }));
  await insert(db.label, size.labels, (i) => ({
    id: id("label", i),
    boardId: id("board", boardIndex(i)),
    name: i < size.boards ? "Priority review" : "Customer report",
    color: i < size.boards ? "red" : "blue",
  }));
  await insert(db.card, size.cards, (i) => ({
    id: card(i),
    columnId: id("column", i % size.columns),
    position: Math.floor(i / size.columns),
    title: `Benchmark card ${i} with a realistic title`,
    description:
      "Tracking support feedback and the next steps for this work item. ".repeat(
        8,
      ),
    createdAt: recent(i),
    updatedAt: recent(i),
    assigneeId: i % 11 === 10 ? null : user(i),
    priority: priorities[i % priorities.length],
    dueDate: i % 7 ? due(i) : null,
    archivedAt: i % 17 === 16 ? recent(i) : null,
    deletedAt: i % 53 === 52 ? recent(i) : null,
    attachmentCount: i < size.attachments && i % 4 < 2 ? 1 : 0,
  }));
  await insert(db.cardLabel, size.cards, (i) => ({
    cardId: card(i),
    labelId: id("label", boardIndex(i) + (i % 3 ? 0 : size.boards)),
    position: 0,
  }));
  await insert(db.cardLabel, Math.ceil(size.cards / 5), (i) => {
    // Spread two-label cards across every board, including board zero.
    const index =
      Math.floor(i / size.boards) * size.boards * 5 + (i % size.boards);
    return {
      cardId: card(index),
      labelId: id("label", boardIndex(index) + (index % 3 ? size.boards : 0)),
      position: 1,
    };
  });
  await insert(db.cardLink, size.cardLinks, (i) => ({
    id: id("link", i),
    boardId: id("board", boardIndex(i)),
    fromCardId: card(i),
    toCardId: card(i + size.boards),
    type: ["blocks", "relates_to", "duplicates"][i % 3],
    createdAt: recent(i),
  }));
  await insert(db.comment, size.comments, (i) => ({
    id: id("comment", i),
    cardId: card(i),
    authorId: user(i + 3),
    text:
      `Support comment ${i}. ` +
      "Notes from the customer investigation. ".repeat(5),
    kind: kinds[i % kinds.length],
    createdAt: recent(i),
    deletedAt: i % 53 === 52 ? recent(i) : null,
  }));
  await insert(db.attachment, size.attachments, (i) => ({
    id: id("file", i),
    cardId: card(i),
    boardId: id("board", boardIndex(i)),
    fileName: `attachment-${i}`,
    storedName: id("file", i),
    sizeBytes: 20_000 + i,
    mimeType: mimeTypes[i % mimeTypes.length],
    uploadedById: user(i + 2),
    isInline: i % 4 === 2,
    descriptionDetached: i % 4 === 3,
    transcodeStatus:
      i % mimeTypes.length === 2 ? (i % 5 ? "done" : "pending") : "none",
    createdAt: recent(i),
  }));
  await insert(db.command, size.commands, (i) => ({
    id: id("command", i),
    boardId: id("board", boardIndex(i)),
    actorId: user(i),
    type: i % 3 ? "UPDATE_CARD" : "MOVE_CARD",
    payload: { cardId: card(i), title: `Changed title ${i}` },
    result: { seq: i, versions: {} },
    touches: [`card:${card(i)}`, `column:${id("column", i % size.columns)}`],
    createdAt: recent(i),
  }));
  await insert(db.activity, size.activity, (i) => ({
    id: id("activity", i),
    boardId: id("board", boardIndex(i)),
    cardId: card(i),
    actorId: user(i),
    type: i % 4 ? "comment_added" : "comment_edited",
    createdAt: recent(i),
  }));
  await insert(db.adminAuditLog, size.audit, (i) => ({
    id: id("audit", i),
    adminId: id("actor", i % size.admins),
    adminEmail: `${id("actor", i % size.admins)}@example.invalid`,
    action: auditActions[i % auditActions.length],
    targetType: targetTypes[i % targetTypes.length],
    targetId:
      i % 5 ? id(targetTypes[i % targetTypes.length], boardIndex(i)) : card(i),
    details: { commandId: id("command", i % size.commands) },
    createdAt: recent(i),
  }));
  await db.$executeRaw`ANALYZE`;
  console.log(JSON.stringify({ preset, rows: size }, null, 2));
}

async function main() {
  const { values } = parseArgs({
    options: {
      preset: { type: "string", default: "gate" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "ADMIN_FILTER_PERF_DATABASE_URL=<migrated scratch DB> node scripts/perf/seed-admin-filters.mjs --preset small|gate|full",
    );
    return;
  }
  if (!Object.hasOwn(PRESETS, values.preset))
    throw new Error("Use --preset small, gate, or full.");
  const db = perfDatabase();
  try {
    await seed(db, values.preset);
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
