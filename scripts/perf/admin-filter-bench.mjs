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
      AND c."dueDate" < ${referenceTime} + INTERVAL '24 hours'`,
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

  if (preset !== "full") return cases;
  const additional = [
    {
      list: "cards",
      facet: "labels-all",
      model: CARDS,
      predicate: sql`EXISTS (
        SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" = ${id("label", 0)}
      ) AND EXISTS (
        SELECT 1 FROM "CardLabel" cl WHERE cl."cardId" = c.id AND cl."labelId" = ${id("label", perfDataset(preset).boards)}
      )`,
    },
    {
      list: "cards",
      facet: "unassigned",
      model: CARDS,
      predicate: sql`c."assigneeId" IS NULL`,
    },
    {
      list: "cards",
      facet: "period",
      model: CARDS,
      predicate: sql`c."createdAt" >= ${referenceTime} - INTERVAL '24 hours'`,
    },
    {
      list: "cards",
      facet: "column",
      model: CARDS,
      predicate: sql`c."columnId" = ${id("column", 0)}`,
    },
    {
      list: "cards",
      facet: "attachments",
      model: CARDS,
      predicate: sql`c."attachmentCount" > 0`,
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
      "cardLinks",
      {
        from: sql`"CardLink" t`,
        select: sql`t.*`,
        order: sql`t."createdAt" DESC`,
      },
      [["type", sql`t.type IN ('blocks')`]],
    ],
    [
      "comments",
      {
        from: sql`"Comment" t`,
        select: sql`t.*`,
        order: sql`t."createdAt" DESC`,
      },
      [
        ["author", sql`t."authorId" IN (${id("user", 0)})`],
        ["kind", sql`t.kind IN ('blocker')`],
      ],
    ],
    [
      "attachments",
      {
        from: sql`"Attachment" t`,
        select: sql`t.*`,
        order: sql`t."createdAt" DESC`,
      },
      [
        ["uploader", sql`t."uploadedById" IN (${id("user", 0)})`],
        ["mime", sql`t."mimeType" LIKE 'image/%'`],
        ["transcode", sql`t."transcodeStatus" = 'pending'`],
        [
          "period",
          sql`t."createdAt" >= ${referenceTime} - INTERVAL '24 hours'`,
        ],
      ],
    ],
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
    [
      "users",
      {
        from: sql`"User" t`,
        select: sql`t.id, t.email, t."createdAt", t."emailVerifiedAt"`,
        order: sql`t."createdAt" DESC`,
      },
      [
        ["verified", sql`t."emailVerifiedAt" IS NULL`],
        ["period", sql`t."createdAt" >= ${referenceTime} - INTERVAL '1 hour'`],
      ],
    ],
    [
      "boards",
      {
        from: sql`"Board" t`,
        select: sql`t.*`,
        order: sql`t."updatedAt" DESC`,
      },
      [
        [
          "adminMember",
          sql`EXISTS (SELECT 1 FROM "BoardMember" m WHERE m."boardId" = t.id
         AND m."userId" = ${id("user", 0)} AND m.role = 'ADMIN' AND m."acceptedAt" IS NOT NULL)`,
        ],
      ],
    ],
  ];
  for (const [list, model, facets] of modelCases) {
    for (const [facet, predicate] of [["unfiltered", unfiltered], ...facets]) {
      additional.push({ list, facet, model, predicate, extended: true });
    }
  }
  return [...cases, ...additional];
}

function statements({ model, predicate }, pageSize) {
  return [
    sql`SELECT ${model.select} FROM ${model.from} ${model.displayJoins ?? Prisma.empty}
      WHERE ${predicate} ORDER BY ${model.order} LIMIT ${pageSize} OFFSET 0`,
    sql`SELECT COUNT(*) FROM ${model.from} WHERE ${predicate}`,
  ];
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
    plans,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      preset: { type: "string", default: "gate" },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "ADMIN_FILTER_PERF_DATABASE_URL=<seeded scratch DB> npm run perf:admin-filters -- --preset small|gate|full [--output timings.json]",
    );
    return;
  }
  const { preset, output } = values;
  if (!Object.hasOwn(PRESETS, preset))
    throw new Error("Use --preset small, gate, or full.");
  const db = perfDatabase();
  const rows = perfDataset(preset);
  try {
    const [cards, firstCard] = await Promise.all([
      db.card.count(),
      db.card.findUnique({
        where: { id: perfId(preset, "card", 0) },
        select: { updatedAt: true },
      }),
    ]);
    if (cards !== rows.cards || !firstCard) {
      throw new Error(
        `Expected the ${preset} fixture in a dedicated database. Run seed-admin-filters.mjs with the matching preset.`,
      );
    }
    const pageSizes = preset === "small" ? [25] : [25, 50, 100];
    const results = [];
    for (const entry of facetCases(preset, firstCard.updatedAt)) {
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
        `${JSON.stringify({ preset, rows, results: summary }, null, 2)}\n`,
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
