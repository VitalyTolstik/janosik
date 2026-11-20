#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import {
  PRESETS,
  perfDatabase,
  perfDataset,
  perfId,
} from "./seed-admin-filters.mjs";

const { sql } = Prisma;
const unfiltered = sql`TRUE`;

// Measure the page and exact count at the SQL boundary. This also lets the
// harness exercise planned predicates before their HTTP rollout.
const CARDS = {
  from: sql`"Card" c`,
  displayJoins: sql`JOIN "Column" co ON co.id = c."columnId" JOIN "Board" b ON b.id = co."boardId" LEFT JOIN "User" u ON u.id = c."assigneeId"`,
  select: sql`c.id, c.title, c."createdAt", c."updatedAt", c."archivedAt", c."deletedAt",
    c."columnId", c.priority, c."dueDate", co.title AS column_title, b.id AS board_id,
    b.title AS board_title, u.id AS assignee_id, u.email`,
  order: sql`c."updatedAt" DESC`,
};

const AUDIT = {
  from: sql`"AdminAuditLog" a`,
  select: sql`a.*`,
  order: sql`a."createdAt" DESC`,
};

const COMMENTS = {
  from: sql`"Comment" t`,
  pageAlias: sql`t`,
  displayJoins: sql`JOIN "Card" c ON c.id = t."cardId" JOIN "User" u ON u.id = t."authorId"`,
  select: sql`t.id, t."cardId", t."authorId", t.text, t.kind, t."createdAt",
    t."updatedAt", t."editedAt", t."deletedAt", c.title, u.email`,
  order: sql`t."createdAt" DESC`,
};

const ATTACHMENTS = {
  from: sql`"Attachment" t`,
  pageAlias: sql`t`,
  displayJoins: sql`JOIN "Card" c ON c.id = t."cardId"
    JOIN "Column" co ON co.id = c."columnId" JOIN "Board" b ON b.id = co."boardId"
    JOIN "User" u ON u.id = t."uploadedById"`,
  select: sql`t.id, t."cardId", t."boardId", t."uploadedById", t."fileName",
    t."storedName", t."mimeType", t."sizeBytes", t."transcodeStatus",
    t."isInline", t."descriptionDetached", t."createdAt", t."deletedAt",
    c.title AS card_title, b.title AS board_title, u.email`,
  order: sql`t."createdAt" DESC`,
};

const USERS = {
  from: sql`"User" t`,
  select: sql`t.id, t.email, t."displayName", t."createdAt", t."disabledAt", t."emailVerifiedAt"`,
  order: sql`t."createdAt" DESC`,
};

const BOARDS = {
  from: sql`"Board" t`,
  pageAlias: sql`t`,
  displayJoins: sql`LEFT JOIN LATERAL (
    SELECT m."userId", u.email FROM "BoardMember" m JOIN "User" u ON u.id = m."userId"
    WHERE m."boardId" = t.id AND m.role = 'ADMIN' AND m."acceptedAt" IS NOT NULL
    ORDER BY m."createdAt" ASC LIMIT 1
  ) owner ON TRUE`,
  select: sql`t.id, t.title, t."createdAt", t."updatedAt", t."archivedAt",
    t."deletedAt", owner."userId", owner.email`,
  order: sql`t."updatedAt" DESC`,
};

const COLUMNS = {
  from: sql`"Column" t`,
  pageAlias: sql`t`,
  pageColumns: sql`t.*, COALESCE(counts.total, 0) AS card_count`,
  pageJoins: sql`LEFT JOIN (
    SELECT "columnId", COUNT(*) AS total FROM "Card"
    WHERE "deletedAt" IS NULL GROUP BY "columnId"
  ) counts ON counts."columnId" = t.id`,
  displayJoins: sql`JOIN "Board" b ON b.id = t."boardId"`,
  select: sql`t.id, t.title, t."wipLimit", t.position, t."deletedAt", t.version,
    t."createdAt", t."updatedAt", t."boardId", b.title AS board_title, t.card_count`,
  order: sql`t."updatedAt" DESC`,
};

const LABELS = {
  from: sql`"Label" t`,
  pageAlias: sql`t`,
  pageColumns: sql`t.*, COALESCE(counts.total, 0) AS card_count`,
  pageJoins: sql`LEFT JOIN (
    SELECT cl."labelId", COUNT(*) AS total FROM "CardLabel" cl
    JOIN "Card" c ON c.id = cl."cardId" WHERE c."deletedAt" IS NULL GROUP BY cl."labelId"
  ) counts ON counts."labelId" = t.id`,
  displayJoins: sql`JOIN "Board" b ON b.id = t."boardId"`,
  select: sql`t.id, t.name, t.color, t.position, t."deletedAt", t.version,
    t."boardId", b.title AS board_title, t.card_count`,
  order: sql`t."boardId" ASC, t.position ASC`,
};

const CHECKLISTS = {
  from: sql`"Checklist" t`,
  pageAlias: sql`t`,
  displayJoins: sql`JOIN "Card" c ON c.id = t."cardId"
    JOIN "Column" co ON co.id = c."columnId" JOIN "Board" b ON b.id = co."boardId"
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ci.done) AS done
      FROM "ChecklistItem" ci WHERE ci."checklistId" = t.id AND ci."deletedAt" IS NULL
    ) items ON TRUE`,
  select: sql`t.id, t.title, t.position, t."deletedAt", t.version, t."cardId",
    c.title AS card_title, b.id AS board_id, b.title AS board_title,
    items.total AS item_count, items.done AS done_count`,
  order: sql`t."cardId" ASC, t.position ASC`,
};

const CARD_LINKS = {
  from: sql`"CardLink" t`,
  pageAlias: sql`t`,
  displayJoins: sql`JOIN "Board" b ON b.id = t."boardId"
    JOIN "Card" src ON src.id = t."fromCardId" JOIN "Card" dst ON dst.id = t."toCardId"`,
  select: sql`t.id, t.type, t.position, t."deletedAt", t."createdAt", t."boardId",
    t."fromCardId", t."toCardId", b.title AS board_title,
    src.title AS from_card_title, dst.title AS to_card_title`,
  order: sql`t."createdAt" DESC`,
};

function contentCases(preset, referenceTime) {
  const { boards } = perfDataset(preset);
  const boardId = perfId(preset, "board", 0);
  // This card has an outgoing and an incoming link on board zero.
  const cardId = perfId(preset, "card", boards);
  const board = sql`t."boardId" = ${boardId}`;
  const checklistBoard = sql`EXISTS (
    SELECT 1 FROM "Card" c JOIN "Column" co ON co.id = c."columnId"
    WHERE c.id = t."cardId" AND co."boardId" = ${boardId}
  )`;
  const checklistCard = sql`t."cardId" = ${cardId}`;
  const linkCard = sql`(t."fromCardId" = ${cardId} OR t."toCardId" = ${cardId})`;
  const linkTypes = sql`t.type IN ('blocks', 'relates_to')`;
  const verified = sql`t."emailVerifiedAt" IS NOT NULL`;
  const unverified = sql`t."emailVerifiedAt" IS NULL`;
  const period = (days) =>
    sql`t."createdAt" >= ${new Date(referenceTime.getTime() - days * 86_400_000)}`;

  return [
    [
      "users",
      USERS,
      [
        ["verified", verified],
        ["unverified", unverified],
        ["period-24h", period(1)],
        ["period-7d", period(7)],
        ["period-30d", period(30)],
        ["verified-period-30d", sql`${verified} AND ${period(30)}`],
        ["unverified-period-7d", sql`${unverified} AND ${period(7)}`],
      ],
    ],
    [
      "boards",
      BOARDS,
      [
        [
          "adminMemberId",
          sql`EXISTS (
            SELECT 1 FROM "BoardMember" m WHERE m."boardId" = t.id
            AND m."userId" = ${perfId(preset, "user", boards)}
            AND m.role = 'ADMIN' AND m."acceptedAt" IS NOT NULL
          )`,
        ],
      ],
    ],
    ["columns", COLUMNS, [["board", board]]],
    ["labels", LABELS, [["board", board]]],
    [
      "checklists",
      CHECKLISTS,
      [
        ["board", checklistBoard],
        ["card", checklistCard],
        ["board-card", sql`${checklistBoard} AND ${checklistCard}`],
      ],
    ],
    [
      "cardLinks",
      CARD_LINKS,
      [
        ["blocks", sql`t.type IN ('blocks')`],
        ["relates_to", sql`t.type IN ('relates_to')`],
        ["duplicates", sql`t.type IN ('duplicates')`],
        ["type-multiple", linkTypes],
        ["card", linkCard],
        ["board", board],
        ["type-board", sql`${linkTypes} AND ${board}`],
        ["type-board-card", sql`${linkTypes} AND ${board} AND ${linkCard}`],
      ],
    ],
  ].flatMap(([list, model, facets]) =>
    [["unfiltered", unfiltered], ...facets].map(([facet, predicate]) => ({
      list,
      model,
      facet,
      predicate,
      extended: true,
    })),
  );
}

function moderationCases(preset, referenceTime) {
  const dayAgo = new Date(referenceTime.getTime() - 86_400_000);
  const period = sql`t."createdAt" >= ${dayAgo}`;
  const boundedPeriod = sql`${period} AND t."createdAt" <= ${referenceTime}`;
  const author = sql`t."authorId" = ${perfId(preset, "user", 0)}`;
  const kind = sql`t.kind IN ('blocker', 'question')`;
  // Fixture row 20 is a pending video, uploaded by user 22.
  const uploader = sql`t."uploadedById" = ${perfId(preset, "user", 22)}`;
  const image = sql`t."mimeType" ILIKE 'image/%'`;
  const video = sql`t."mimeType" ILIKE 'video/%'`;
  const pdf = sql`t."mimeType" ILIKE 'application/pdf'`;
  const document = sql`(t."mimeType" ILIKE 'text/%'
    OR LOWER(t."mimeType") IN ('application/rtf', 'application/msword',
      'application/vnd.ms-excel', 'application/vnd.ms-powerpoint')
    OR t."mimeType" ILIKE 'application/vnd.openxmlformats-officedocument.%')`;
  const pending = sql`t."transcodeStatus" = 'pending'`;

  return [
    [
      "comments",
      COMMENTS,
      [
        ["author", author],
        ["kind", sql`t.kind IN ('blocker')`],
        ["kind-multiple", kind],
        ["author-period", sql`${author} AND ${period}`],
        ["kind-period", sql`${kind} AND ${period}`],
        ["combined", sql`${author} AND ${kind} AND ${boundedPeriod}`],
      ],
    ],
    [
      "attachments",
      ATTACHMENTS,
      [
        ["uploader", uploader],
        ["mime", image],
        ["mime-video", video],
        ["mime-pdf", pdf],
        ["mime-document", document],
        [
          "mime-other",
          sql`NOT (${image} OR ${video} OR ${pdf} OR ${document})`,
        ],
        ["transcode", pending],
        ["transcode-failed", sql`t."transcodeStatus" = 'failed'`],
        ["transcode-done", sql`t."transcodeStatus" = 'done'`],
        ["transcode-none", sql`t."transcodeStatus" = 'none'`],
        ["uploader-period", sql`${uploader} AND ${period}`],
        ["mime-period", sql`${document} AND ${period}`],
        ["transcode-period", sql`${pending} AND ${period}`],
        [
          "combined",
          sql`${uploader} AND ${video} AND ${pending} AND ${boundedPeriod}`,
        ],
      ],
    ],
  ].flatMap(([list, model, facets]) =>
    [["unfiltered", unfiltered], ["period", period], ...facets].map(
      ([facet, predicate]) => ({
        list,
        model,
        facet,
        predicate,
        extended: true,
      }),
    ),
  );
}

function facetCases(preset, referenceTime) {
  const id = (model, index) => perfId(preset, model, index);
  const cases = [
    { list: "cards", facet: "unfiltered", model: CARDS, predicate: unfiltered },
    {
      list: "cards",
      facet: "board",
      model: CARDS,
      predicate: sql`EXISTS (SELECT 1 FROM "Column" scope
      WHERE scope.id = c."columnId" AND scope."boardId" = ${id("board", 0)})`,
    },
    {
      list: "cards",
      facet: "label",
      model: CARDS,
      predicate: sql`EXISTS (
      SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" = ${id("label", 0)}
    )`,
    },
    {
      list: "cards",
      facet: "assignee",
      model: CARDS,
      predicate: sql`c."assigneeId" IN (${id("user", 0)})`,
    },
    {
      list: "cards",
      facet: "priority",
      model: CARDS,
      predicate: sql`(c.priority IN ('medium') OR c.priority IS NULL)`,
    },
    {
      list: "cards",
      facet: "due",
      model: CARDS,
      predicate: sql`c."dueDate" >= ${referenceTime}
      AND c."dueDate" <= ${referenceTime} + INTERVAL '24 hours'`,
    },
    { list: "audit", facet: "unfiltered", model: AUDIT, predicate: unfiltered },
    {
      list: "audit",
      facet: "actor",
      model: AUDIT,
      predicate: sql`a."adminId" IN (${id("actor", 0)})`,
    },
    {
      list: "audit",
      facet: "action",
      model: AUDIT,
      predicate: sql`a.action IN ('board.command')`,
    },
  ];

  const secondLabel = id("label", perfDataset(preset).boards);
  const dayAgo = new Date(referenceTime.getTime() - 86_400_000);
  const additionalCards = [
    [
      "labels-any",
      sql`EXISTS (
      SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" IN (${id("label", 0)}, ${secondLabel})
    )`,
    ],
    [
      "labels-all",
      sql`EXISTS (
      SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" = ${id("label", 0)}
    ) AND EXISTS (
      SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" = ${secondLabel}
    )`,
    ],
    [
      "assignee-or-unassigned",
      sql`(c."assigneeId" IN (${id("user", 0)}, ${id("user", 1)}) OR c."assigneeId" IS NULL)`,
    ],
    ["unassigned", sql`c."assigneeId" IS NULL`],
    ["overdue", sql`c."dueDate" < ${referenceTime}`],
    ["no-due-date", sql`c."dueDate" IS NULL`],
    ["period", sql`c."createdAt" >= ${dayAgo}`],
    ["attachments", sql`c."attachmentCount" > 0`],
    ["no-attachments", sql`c."attachmentCount" = 0`],
    [
      "combined",
      sql`(c.priority IN ('medium', 'high') OR c.priority IS NULL)
      AND (c."assigneeId" IN (${id("user", 0)}, ${id("user", 1)}) OR c."assigneeId" IS NULL)
      AND c."dueDate" < ${referenceTime}
      AND c."createdAt" >= ${new Date(referenceTime.getTime() - 7 * 86_400_000)}
      AND c."attachmentCount" = 0`,
    ],
  ].map(([facet, predicate]) => ({
    list: "cards",
    facet,
    model: CARDS,
    predicate,
    extended: true,
  }));

  const core = [
    ...cases,
    ...additionalCards,
    ...moderationCases(preset, referenceTime),
    ...contentCases(preset, referenceTime),
  ];
  if (preset !== "full") return core;
  const additional = [
    {
      list: "cards",
      facet: "column",
      model: CARDS,
      predicate: sql`c."columnId" = ${id("column", 0)}`,
    },
    {
      list: "audit",
      facet: "target",
      model: AUDIT,
      predicate: sql`a."targetType" IN ('card') AND a."targetId" = ${id("card", 0)}`,
    },
  ].map((entry) => ({ ...entry, extended: true }));

  const modelCases = [
    [
      "commands",
      {
        from: sql`"Command" t`,
        select: sql`t.*`,
        order: sql`t."createdAt" DESC, t.seq DESC`,
      },
      [
        ["actor", sql`t."actorId" IN (${id("user", 0)})`],
        ["type", sql`t.type IN ('MOVE_CARD')`],
      ],
    ],
    [
      "activity",
      {
        from: sql`"Activity" t`,
        select: sql`t.*`,
        order: sql`t."createdAt" DESC`,
      },
      [
        ["actor", sql`t."actorId" IN (${id("user", 0)})`],
        ["type", sql`t.type IN ('comment_added')`],
      ],
    ],
  ];
  for (const [list, model, facets] of modelCases) {
    for (const [facet, predicate] of [["unfiltered", unfiltered], ...facets]) {
      additional.push({ list, facet, model, predicate, extended: true });
    }
  }
  return [...core, ...additional];
}

function statements({ model, predicate }, pageSize) {
  const order = sql`ORDER BY ${model.order}`;
  const window = sql`LIMIT ${pageSize} OFFSET 0`;
  // Prisma computes relation counts before pagination and loads relations after it.
  const page = model.pageAlias
    ? sql`SELECT ${model.select} FROM (
        SELECT ${model.pageColumns ?? sql`${model.pageAlias}.*`} FROM ${model.from}
        ${model.pageJoins ?? Prisma.empty} WHERE ${predicate} ${order} ${window}
      ) ${model.pageAlias} ${model.displayJoins} ${order}`
    : sql`SELECT ${model.select} FROM ${model.from} ${model.displayJoins ?? Prisma.empty}
        WHERE ${predicate} ${order} ${window}`;
  return [page, sql`SELECT COUNT(*) FROM ${model.from} WHERE ${predicate}`];
}

async function timed(db, queries) {
  const start = performance.now();
  const [, [{ count }]] = await db.$transaction(
    queries.map((query) => db.$queryRaw(query)),
  );
  return { ms: performance.now() - start, total: Number(count) };
}

function percentile(values, fraction) {
  const sorted = values.map(({ ms }) => ms).sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function largeSeqScans({ Plan }) {
  const scans = [];
  const visit = (node) => {
    const examined =
      (node["Actual Rows"] + (node["Rows Removed by Filter"] ?? 0)) *
      node["Actual Loops"];
    if (node["Node Type"] === "Seq Scan" && examined >= 10_000) {
      scans.push({ relation: node["Relation Name"], examined });
    }
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(Plan);
  return scans;
}

async function measure(db, entry, pageSize, samples) {
  const queries = statements(entry, pageSize);
  const cold = [];
  for (let i = 0; i < samples.cold; i++) {
    const fresh = perfDatabase();
    try {
      await fresh.$connect();
      cold.push(await timed(fresh, queries));
    } finally {
      await fresh.$disconnect();
    }
  }
  await timed(db, queries);
  const warm = [];
  for (let i = 0; i < samples.warm; i++) {
    warm.push(await timed(db, queries));
  }
  const plans = {};
  for (const [index, statement] of ["page", "count"].entries()) {
    const [result] =
      await db.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${queries[index]}`;
    plans[statement] = result["QUERY PLAN"][0];
  }
  return {
    list: entry.list,
    facet: entry.facet,
    pageSize,
    total: warm[0].total,
    cold,
    warm,
    coldP50: percentile(cold, 0.5),
    coldP95: percentile(cold, 0.95),
    warmP50: percentile(warm, 0.5),
    warmP95: percentile(warm, 0.95),
    largeSeqScans: Object.values(plans).flatMap(largeSeqScans),
    queries: queries.map(({ text, values }) => ({ text, values })),
    plans,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      preset: { type: "string", default: "gate" },
      output: { type: "string" },
      cards: { type: "boolean" },
      moderation: { type: "boolean" },
      content: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "ADMIN_FILTER_PERF_DATABASE_URL=<seeded scratch DB> npm run perf:admin-filters -- --preset small|gate|full [--cards|--moderation|--content] [--output timings.json]",
    );
    return;
  }
  const {
    preset,
    output,
    cards: cardsOnly,
    moderation: moderationOnly,
    content: contentOnly,
  } = values;
  if (!Object.hasOwn(PRESETS, preset))
    throw new Error("Use --preset small, gate, or full.");
  if ([cardsOnly, moderationOnly, contentOnly].filter(Boolean).length > 1)
    throw new Error("Choose one benchmark scope.");
  const db = perfDatabase();
  const rows = perfDataset(preset);
  try {
    const [cards, firstCard, [{ version }]] = await Promise.all([
      db.card.count(),
      db.card.findUnique({
        where: { id: perfId(preset, "card", 0) },
        select: { updatedAt: true },
      }),
      db.$queryRaw`SELECT current_setting('server_version') AS version`,
    ]);
    if (cards !== rows.cards || !firstCard) {
      throw new Error(
        `Expected the ${preset} fixture in a dedicated database. Run seed-admin-filters.mjs with the matching preset.`,
      );
    }
    if (!cardsOnly && !contentOnly) {
      const [comments, attachments] = await Promise.all([
        db.comment.count(),
        db.attachment.count(),
      ]);
      if (comments !== rows.comments || attachments !== rows.attachments) {
        throw new Error(
          "Expected the matching moderation fixture in a dedicated database.",
        );
      }
    }
    if (!cardsOnly && !moderationOnly) {
      const counts = await Promise.all(
        Object.entries({
          users: db.user,
          boards: db.board,
          columns: db.column,
          labels: db.label,
          checklists: db.checklist,
          checklistItems: db.checklistItem,
          cardLinks: db.cardLink,
        }).map(async ([list, model]) => (await model.count()) === rows[list]),
      );
      if (counts.includes(false)) {
        throw new Error(
          "Expected the matching content fixture in a dedicated database.",
        );
      }
    }
    const pageSizes = preset === "small" ? [25] : [25, 50, 100];
    const results = [];
    const entries = contentOnly
      ? contentCases(preset, firstCard.updatedAt)
      : facetCases(preset, firstCard.updatedAt);
    for (const entry of entries) {
      if (cardsOnly && entry.list !== "cards") continue;
      if (
        moderationOnly &&
        entry.list !== "comments" &&
        entry.list !== "attachments"
      )
        continue;
      const samples =
        preset === "small"
          ? { cold: 1, warm: 3 }
          : preset === "full" && !entry.extended
            ? { cold: 5, warm: 20 }
            : { cold: 3, warm: 10 };
      for (const pageSize of pageSizes)
        results.push(await measure(db, entry, pageSize, samples));
    }
    const summary = results.map((row) => {
      const baseline = results.find(
        (candidate) =>
          candidate.facet === "unfiltered" &&
          candidate.list === row.list &&
          candidate.pageSize === row.pageSize,
      );
      const warmP95Delta = (row.warmP95 / baseline.warmP95 - 1) * 100;
      return {
        ...row,
        warmP95Delta,
        withinBudget:
          row.facet === "unfiltered" ||
          (warmP95Delta <= 20 && row.largeSeqScans.length === 0),
      };
    });
    console.log(
      "Times are milliseconds for the page and exact count together. Cold samples use a fresh connection with shared buffers intact.",
    );
    console.table(
      summary.map(
        ({
          list,
          facet,
          pageSize,
          total,
          coldP50,
          coldP95,
          warmP50,
          warmP95,
          warmP95Delta,
          largeSeqScans,
          withinBudget,
        }) => ({
          list,
          facet,
          pageSize,
          total,
          coldP50: coldP50.toFixed(2),
          coldP95: coldP95.toFixed(2),
          warmP50: warmP50.toFixed(2),
          warmP95: warmP95.toFixed(2),
          "p95 delta": `${warmP95Delta.toFixed(1)}%`,
          "large seq scans": largeSeqScans.length,
          budget: withinBudget ? "pass" : "fail",
        }),
      ),
    );
    const failures = summary.filter((row) => !row.withinBudget);
    if (failures.length > 0) {
      console.error(
        `${failures.length} benchmark case(s) exceeded the budget.`,
      );
      process.exitCode = 1;
    }
    if (output) {
      await writeFile(
        output,
        `${JSON.stringify({ preset, version, referenceTime: firstCard.updatedAt, rows, results: summary }, null, 2)}\n`,
      );
      console.log(`Saved samples and EXPLAIN plans to ${output}`);
    } else {
      for (const row of summary)
        console.log(
          JSON.stringify({
            list: row.list,
            facet: row.facet,
            pageSize: row.pageSize,
            plans: row.plans,
          }),
        );
    }
  } finally {
    await db.$disconnect();
  }
}

await main();
