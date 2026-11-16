/**
 * TASK-179 pixel-parity disposable demo data.
 *
 * Fills a DISPOSABLE PostgreSQL database (never the live dev DB) with a
 * realistic agent-control scene:
 *
 * - 2 boards, ADMIN on Agent Ops Demo and MEMBER on Website Relaunch;
 * - live/waiting/paused/stale/terminal sessions from two token owners;
 * - 2 pending approvals from different agents plus decided/expired/cancelled/
 *   consumed history;
 * - applied runs created through the real command transport, so every run has
 *   genuine Command + CommandPreimage rows and rollback preview works;
 * - a conflict run, a reverted run, a failed run and a retention-expired run
 *   (commands kept, preimages removed) for the honest rollback states.
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://… npx prisma migrate deploy -w backend
 *   backend running on API_URL with the same database
 *
 * Usage:
 *   DATABASE_URL=postgresql://janosik:pixel@127.0.0.1:5434/janosik_pixel \
 *   API_URL=http://127.0.0.1:5302 \
 *   node scripts/seed-agent-pixel-demo.mjs
 *
 * The script refuses to run unless SEED_ALLOW=1, so a stray invocation cannot
 * wipe a developer database by accident.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:5302").replace(
  /\/$/,
  "",
);
const PASSWORD = "pixel-demo-password";
const prisma = new PrismaClient();

if (process.env.SEED_ALLOW !== "1") {
  console.error(
    "Refusing to seed: set SEED_ALLOW=1 and point DATABASE_URL at a disposable database.",
  );
  process.exit(1);
}

const now = Date.now();
const minutes = (value) => value * 60_000;
const seconds = (value) => value * 1_000;
const hours = (value) => value * 3_600_000;
const at = (offsetMs) => new Date(now + offsetMs);

const ids = {
  userAdmin: "px-user-admin",
  userMember: "px-user-member",
  boardOps: "px-board-agent-ops",
  boardSite: "px-board-website",
  columnOpsBacklog: "px-col-ops-backlog",
  columnOpsProgress: "px-col-ops-progress",
  columnOpsReview: "px-col-ops-review",
  columnOpsDone: "px-col-ops-done",
  columnSiteBacklog: "px-col-site-backlog",
  columnSiteProgress: "px-col-site-progress",
  columnSiteReview: "px-col-site-review",
  columnSiteDone: "px-col-site-done",
  cardClaim: "px-card-card-claim",
  cardOnboarding: "px-card-old-onboarding",
  cardApprovalInbox: "px-card-approval-inbox",
  cardMcp: "px-card-mcp-write",
  cardHeartbeat: "px-card-heartbeat-copy",
  cardLanding: "px-card-landing-rewrite",
  cardMcpCallouts: "px-card-mcp-callouts",
  cardPricingCopy: "px-card-pricing-copy",
  cardPricingRefs: "px-card-pricing-refs",
  cardReleaseNotes: "px-card-release-notes",
  cardApiReference: "px-card-api-reference",
  cardDocsIndex: "px-card-docs-index",
  tokenClaude: "px-token-claude",
  tokenDocs: "px-token-docs",
  tokenRelease: "px-token-release",
  tokenReleaseArchive: "px-token-release-archive",
  tokenCi: "px-token-ci",
  sessionRefactor: "px-session-refactor",
  sessionLanding: "px-session-landing",
  sessionApi: "px-session-api",
  sessionRelease: "px-session-release",
  sessionDeploy: "px-session-deploy",
  sessionPricing: "px-session-pricing",
  sessionCi: "px-session-ci",
  sessionIdle: "px-session-idle",
  sessionStale: "px-session-stale",
  sessionDone: "px-session-done",
  sessionFailed: "px-session-failed",
  sessionCancelled: "px-session-cancelled",
};

const rawTokens = {
  [ids.tokenClaude]: "jnk_pixel_claude_demo_0000000000000000000000000000",
  [ids.tokenDocs]: "jnk_pixel_docs_demo_000000000000000000000000000000",
  [ids.tokenRelease]: "jnk_pixel_release_demo_00000000000000000000000000",
  [ids.tokenReleaseArchive]: "jnk_pixel_release_archive_0000000000000000000000",
  [ids.tokenCi]: "jnk_pixel_ci_demo_0000000000000000000000000000000",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function api(path, { token, body, sessionId, method = "POST" } = {}) {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { "x-agent-session": sessionId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${response.status} ${JSON.stringify(parsed)}`,
    );
  }
  return { body: parsed, headers: response.headers };
}

let commandCounter = 0;
function command(boardOrAction, maybeAction) {
  commandCounter += 1;
  const boardId =
    typeof boardOrAction === "string" ? boardOrAction : ids.boardOps;
  const action =
    typeof boardOrAction === "string" ? maybeAction : boardOrAction;
  return {
    commandId: `px-seed-cmd-${String(commandCounter).padStart(3, "0")}`,
    action: {
      boardId,
      at: now,
      ...action,
    },
  };
}

async function applyRun({
  boardId = ids.boardOps,
  token,
  sessionId,
  clientRunId,
  commands,
  atMs,
  kind,
}) {
  // A real PAT batch creates the AgentRun and every pre-image.
  const result = await api(`/boards/${boardId}/commands/batch`, {
    token,
    // Sessions are inserted later in this fixture; link them by direct DB
    // update below instead of presenting a not-yet-existing session header.
    sessionId: undefined,
    body: { clientRunId, commands },
  });
  let runId = result.body.runId ?? result.headers.get("x-run-id");
  if (!runId) throw new Error(`No run id for ${clientRunId}`);
  // Readable ids preserve the mockup's `Run #128` language while the real
  // command transport still creates the run. No foreign keys reference the
  // id, so the scalar rows are updated explicitly.
  const numeric = /(\d+)$/.exec(clientRunId ?? "")?.[1];
  if (numeric !== undefined) {
    const readable = `run-${numeric}`;
    await prisma.agentRun.update({
      where: { id: runId },
      data: { id: readable },
    });
    await prisma.command.updateMany({
      where: { runId },
      data: { runId: readable },
    });
    await prisma.commandPreimage.updateMany({
      where: { runId },
      data: { runId: readable },
    });
    runId = readable;
  }
  const when = new Date(atMs);
  const appliedAt = new Date(atMs + 12_000 + (commands.length - 1) * 3_000);
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      createdAt: when,
      appliedAt,
      planHash: sha256(`plan:${clientRunId}`).slice(0, 64),
      ...(sessionId === undefined ? {} : { agentSessionId: sessionId }),
    },
  });
  await prisma.command.updateMany({
    where: { runId },
    data: { createdAt: when },
  });
  if (kind !== undefined) {
    await prisma.agentRun.update({ where: { id: runId }, data: { kind } });
  }
  return runId;
}

async function main() {
  // --- clean the disposable database -------------------------------------
  await prisma.commandPreimage.deleteMany();
  await prisma.command.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.agentSession.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.attentionNotification.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.cardLabel.deleteMany();
  await prisma.card.deleteMany();
  await prisma.label.deleteMany();
  await prisma.column.deleteMany();
  await prisma.boardMember.deleteMany();
  await prisma.board.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await argon2.hash(PASSWORD);

  const admin = await prisma.user.create({
    data: {
      id: ids.userAdmin,
      email: "pixel-admin@example.com",
      passwordHash,
      displayName: "Audit Admin",
      emailVerifiedAt: new Date(now - hours(24 * 30)),
      locale: "en",
    },
  });
  const member = await prisma.user.create({
    data: {
      id: ids.userMember,
      email: "pixel-member@example.com",
      passwordHash,
      displayName: "Riley Member",
      emailVerifiedAt: new Date(now - hours(24 * 28)),
      locale: "en",
    },
  });

  await prisma.board.createMany({
    data: [
      { id: ids.boardOps, title: "Agent Ops Demo", version: 4 },
      { id: ids.boardSite, title: "Website Relaunch", version: 7 },
    ],
  });

  await prisma.boardMember.createMany({
    data: [
      {
        boardId: ids.boardOps,
        userId: admin.id,
        role: "ADMIN",
        acceptedAt: new Date(now - hours(24 * 20)),
      },
      {
        boardId: ids.boardSite,
        userId: admin.id,
        role: "MEMBER",
        acceptedAt: new Date(now - hours(24 * 19)),
      },
      {
        boardId: ids.boardOps,
        userId: member.id,
        role: "MEMBER",
        acceptedAt: new Date(now - hours(24 * 18)),
      },
      {
        boardId: ids.boardSite,
        userId: member.id,
        role: "ADMIN",
        acceptedAt: new Date(now - hours(24 * 17)),
      },
    ],
  });

  await prisma.column.createMany({
    data: [
      {
        id: ids.columnOpsBacklog,
        boardId: ids.boardOps,
        title: "Backlog",
        position: 0,
      },
      {
        id: ids.columnOpsProgress,
        boardId: ids.boardOps,
        title: "In progress",
        position: 1,
      },
      {
        id: ids.columnOpsReview,
        boardId: ids.boardOps,
        title: "Review",
        position: 2,
      },
      {
        id: ids.columnOpsDone,
        boardId: ids.boardOps,
        title: "Done",
        position: 3,
      },
      {
        id: ids.columnSiteBacklog,
        boardId: ids.boardSite,
        title: "Backlog",
        position: 0,
      },
      {
        id: ids.columnSiteProgress,
        boardId: ids.boardSite,
        title: "In progress",
        position: 1,
      },
      {
        id: ids.columnSiteReview,
        boardId: ids.boardSite,
        title: "Review",
        position: 2,
      },
      {
        id: ids.columnSiteDone,
        boardId: ids.boardSite,
        title: "Done",
        position: 3,
      },
    ],
  });

  await prisma.card.createMany({
    data: [
      {
        id: ids.cardClaim,
        columnId: ids.columnOpsBacklog,
        title: "Card claim visibility",
        position: 0,
        version: 2,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardOnboarding,
        columnId: ids.columnOpsBacklog,
        title: "Old onboarding draft",
        position: 1,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardApprovalInbox,
        columnId: ids.columnOpsProgress,
        title: "Approval inbox polish",
        position: 0,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardMcp,
        columnId: ids.columnOpsProgress,
        title: "MCP write contract",
        position: 1,
        version: 3,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardHeartbeat,
        columnId: ids.columnOpsReview,
        title: "Session heartbeat copy",
        position: 0,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardLanding,
        columnId: ids.columnOpsReview,
        title: "Landing page rewrite",
        position: 1,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardMcpCallouts,
        columnId: ids.columnOpsDone,
        title: "MCP callouts",
        position: 0,
        version: 2,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardPricingCopy,
        columnId: ids.columnSiteDone,
        title: "Pricing page copy",
        position: 0,
        version: 4,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardPricingRefs,
        columnId: ids.columnSiteReview,
        title: "Pricing copy references",
        position: 0,
        version: 2,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardReleaseNotes,
        columnId: ids.columnSiteProgress,
        title: "Release notes",
        position: 0,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardApiReference,
        columnId: ids.columnSiteProgress,
        title: "API reference",
        position: 1,
        version: 2,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
      {
        id: ids.cardDocsIndex,
        columnId: ids.columnSiteBacklog,
        title: "Docs index",
        position: 0,
        version: 1,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
    ],
  });

  await prisma.apiToken.createMany({
    data: [
      {
        id: ids.tokenClaude,
        userId: admin.id,
        name: "Claude Code — audit",
        tokenHash: sha256(rawTokens[ids.tokenClaude]),
        boardId: ids.boardOps,
        scopePreset: "admin",
        trustedCi: true,
        lastUsedAt: at(-minutes(1)),
      },
      {
        id: ids.tokenDocs,
        userId: admin.id,
        name: "Docs agent",
        tokenHash: sha256(rawTokens[ids.tokenDocs]),
        scopePreset: "worker",
        lastUsedAt: at(-minutes(3)),
      },
      {
        id: ids.tokenRelease,
        userId: member.id,
        name: "Release bot",
        tokenHash: sha256(rawTokens[ids.tokenRelease]),
        scopePreset: "admin",
        trustedCi: true,
        lastUsedAt: at(-minutes(2)),
      },
      {
        id: ids.tokenReleaseArchive,
        userId: admin.id,
        name: "Release bot",
        tokenHash: sha256(rawTokens[ids.tokenReleaseArchive]),
        scopePreset: "worker",
        lastUsedAt: at(-hours(5)),
      },
      {
        id: ids.tokenCi,
        userId: admin.id,
        name: "Release agent (CI)",
        tokenHash: sha256(rawTokens[ids.tokenCi]),
        scopePreset: "worker",
        lastUsedAt: at(-minutes(18)),
      },
    ],
  });

  // --- runs through the real command transport ---------------------------
  const run128 = await applyRun({
    token: rawTokens[ids.tokenCi],
    sessionId: ids.sessionCi,
    clientRunId: "seed-run-128",
    atMs: now - minutes(36),
    kind: "single",
    commands: [
      // Applies the `px-approval-consumed` plan, so the approval → run
      // back-link and the run → approval link point at the same work.
      command({
        type: "MOVE_CARD",
        cardId: ids.cardApprovalInbox,
        fromColumnId: ids.columnOpsProgress,
        fromIndex: 0,
        toColumnId: ids.columnOpsDone,
        toIndex: 1,
      }),
    ],
  });

  const run126 = await applyRun({
    token: rawTokens[ids.tokenDocs],
    sessionId: ids.sessionApi,
    clientRunId: "seed-run-126",
    atMs: now - hours(1) - minutes(9),
    kind: "single",
    commands: [
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardClaim,
        description: "API reference sweep — exact MCP transport contract.",
      }),
    ],
  });

  const run124 = await applyRun({
    token: rawTokens[ids.tokenRelease],
    sessionId: null,
    clientRunId: "seed-run-124",
    atMs: now - hours(6) - minutes(51),
    kind: "single",
    commands: [
      command({
        type: "DELETE_CARD",
        cardId: ids.cardOnboarding,
      }),
    ],
  });
  await prisma.agentRun.update({
    where: { id: run124 },
    data: { status: "reverted", revertedAt: new Date(now - hours(6)) },
  });

  const run121 = await applyRun({
    token: rawTokens[ids.tokenRelease],
    sessionId: null,
    clientRunId: "seed-run-121",
    atMs: now - hours(7) - minutes(18),
    kind: "plan",
    commands: [
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardLanding,
        title: "Landing page rewrite",
        description: "Final landing page copy.",
      }),
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardLanding,
        description: "Final landing page copy with the annual toggle.",
      }),
    ],
  });

  // A later human edit bumps the card version: the run's preview now reports
  // a genuine conflict and apply stays disabled.
  await prisma.card.update({
    where: { id: ids.cardLanding },
    data: {
      version: { increment: 1 },
      title: "Landing page rewrite — final",
      updatedAt: new Date(now - hours(2)),
    },
  });

  const run118 = await applyRun({
    token: rawTokens[ids.tokenDocs],
    sessionId: null,
    clientRunId: "seed-run-118",
    atMs: now - hours(12),
    kind: "batch",
    commands: [
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardMcpCallouts,
        description: "MCP callouts synced from the docs build.",
      }),
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardMcpCallouts,
        title: "MCP callouts",
        description: "MCP callouts — failed mid-sync.",
      }),
    ],
  });
  await prisma.agentRun.update({
    where: { id: run118 },
    data: { status: "failed" },
  });

  // Sixth Agent Ops run: the board list still starts at five rows, so the
  // reviewer can exercise Load more and the next server cursor.
  const run108 = await applyRun({
    token: rawTokens[ids.tokenClaude],
    sessionId: ids.sessionRefactor,
    clientRunId: "seed-run-108",
    atMs: Math.max(
      now - hours(1) - minutes(47),
      new Date(now).setHours(0, 0, 0, 0),
    ),
    kind: "single",
    commands: [
      command({
        type: "UPDATE_CARD",
        cardId: ids.cardMcp,
        description: "Approval inbox copy reviewed after the docs build.",
      }),
    ],
  });

  const movedCards = [
    { cardId: ids.cardPricingRefs, from: ids.columnSiteReview, index: 0 },
    { cardId: ids.cardReleaseNotes, from: ids.columnSiteProgress, index: 0 },
    { cardId: ids.cardApiReference, from: ids.columnSiteProgress, index: 1 },
  ];
  const run115 = await applyRun({
    boardId: ids.boardSite,
    token: rawTokens[ids.tokenCi],
    sessionId: ids.sessionDeploy,
    clientRunId: "seed-run-115",
    atMs: now - hours(1) - minutes(50),
    kind: "batch",
    commands: movedCards.map(({ cardId, from, index }) =>
      command(ids.boardSite, {
        type: "MOVE_CARD",
        cardId,
        fromColumnId: from,
        fromIndex: index,
        toColumnId: ids.columnSiteDone,
        toIndex: 0,
      }),
    ),
  });

  const run112 = await applyRun({
    boardId: ids.boardSite,
    token: rawTokens[ids.tokenDocs],
    sessionId: ids.sessionPricing,
    clientRunId: "seed-run-112",
    atMs: now - minutes(20),
    kind: "single",
    commands: [
      command(ids.boardSite, {
        type: "UPDATE_CARD",
        cardId: ids.cardDocsIndex,
        description: "API notes from the MCP transport review.",
      }),
    ],
  });

  // Retention case: the run row and commands survive, the pre-images do not.
  // The detail still renders; preview must say `run_expired` honestly.
  const runExpired = await applyRun({
    boardId: ids.boardSite,
    token: rawTokens[ids.tokenCi],
    sessionId: null,
    clientRunId: "seed-run-104",
    atMs: now - hours(52),
    kind: "batch",
    commands: [
      command(ids.boardSite, {
        type: "ADD_CARD",
        newCardId: "px-card-expired-retention",
        columnId: ids.columnSiteBacklog,
        title: "Retention sample",
      }),
    ],
  });
  await prisma.commandPreimage.deleteMany({ where: { runId: runExpired } });

  // --- approvals ---------------------------------------------------------
  const hash = (seed) => sha256(`approval:${seed}`).slice(0, 64);
  const approvalPlan = (cardId, action, extra = {}) => ({
    commands: [
      {
        commandId: `px-plan-${cardId}-${action.type}`,
        action: {
          boardId: ids.boardOps,
          at: now,
          cardId,
          ...action,
        },
      },
    ],
    ...extra,
  });

  const approvals = [
    {
      id: "px-approval-landing",
      boardId: ids.boardOps,
      cardId: ids.cardLanding,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenClaude,
      agentSessionId: ids.sessionLanding,
      kind: "custom",
      actionType: "MOVE_CARD",
      summary: "Move “Landing page rewrite” to Review",
      risk: "medium",
      planHash: hash("landing"),
      status: "pending",
      expiresAt: at(hours(72)),
      createdAt: at(-minutes(4)),
      plan: approvalPlan(ids.cardLanding, {
        type: "MOVE_CARD",
        fromColumnId: ids.columnOpsProgress,
        fromIndex: 0,
        toColumnId: ids.columnOpsReview,
        toIndex: 1,
      }),
    },
    {
      id: "px-approval-delete-claim",
      boardId: ids.boardOps,
      cardId: ids.cardClaim,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenDocs,
      agentSessionId: ids.sessionApi,
      kind: "destructive",
      actionType: "DELETE_CARD",
      summary: "Delete card “Card claim visibility”",
      risk: "medium",
      planHash: hash("delete-claim"),
      status: "pending",
      expiresAt: at(hours(72)),
      createdAt: at(-minutes(8)),
      plan: approvalPlan(ids.cardClaim, { type: "DELETE_CARD" }),
    },
    {
      id: "px-approval-approved",
      boardId: ids.boardOps,
      cardId: ids.cardMcpCallouts,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenClaude,
      agentSessionId: ids.sessionRefactor,
      kind: "done",
      actionType: "MOVE_CARD",
      summary: "Move “MCP callouts” to Done",
      risk: "low",
      planHash: hash("approved"),
      status: "approved",
      // Deliberately past the decision TTL: only a pending row may become
      // expired; an approved row keeps its honest approved state.
      expiresAt: at(-minutes(10)),
      createdAt: at(-hours(2)),
      decidedBy: admin.id,
      decidedAt: at(-hours(1) - minutes(48)),
      decisionComment: "Ship it with the docs release.",
      plan: approvalPlan(ids.cardMcpCallouts, {
        type: "MOVE_CARD",
        fromColumnId: ids.columnOpsProgress,
        fromIndex: 1,
        toColumnId: ids.columnOpsDone,
        toIndex: 0,
      }),
    },
    {
      id: "px-approval-rejected",
      boardId: ids.boardOps,
      cardId: ids.cardHeartbeat,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenDocs,
      agentSessionId: ids.sessionApi,
      kind: "destructive",
      actionType: "DELETE_CARD",
      summary: "Delete card “Session heartbeat copy”",
      risk: "high",
      planHash: hash("rejected"),
      status: "rejected",
      expiresAt: at(hours(1)),
      createdAt: at(-hours(3)),
      decidedBy: admin.id,
      decidedAt: at(-hours(2) - minutes(20)),
      decisionComment: "Keep it until the heartbeat copy review lands.",
      plan: approvalPlan(ids.cardHeartbeat, { type: "DELETE_CARD" }),
    },
    {
      id: "px-approval-cancelled",
      boardId: ids.boardOps,
      cardId: ids.cardMcp,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenClaude,
      agentSessionId: ids.sessionRefactor,
      kind: "custom",
      actionType: "UPDATE_CARD",
      summary: "Rewrite the MCP write contract",
      risk: "low",
      planHash: hash("cancelled"),
      status: "cancelled",
      expiresAt: at(hours(2)),
      createdAt: at(-hours(4)),
      decidedBy: admin.id,
      decidedAt: at(-hours(3) - minutes(10)),
      decisionComment: "Superseded by the API reference sweep.",
      plan: approvalPlan(ids.cardMcp, {
        type: "UPDATE_CARD",
        title: "MCP write contract",
      }),
    },
    {
      id: "px-approval-expired",
      boardId: ids.boardOps,
      cardId: ids.cardHeartbeat,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenReleaseArchive,
      // This archival token has no session on the board.
      agentSessionId: null,
      kind: "custom",
      actionType: "UPDATE_CARD",
      summary: "Refresh the heartbeat copy",
      risk: "medium",
      planHash: hash("expired"),
      status: "pending",
      expiresAt: at(-minutes(22)),
      createdAt: at(-hours(5)),
      plan: approvalPlan(ids.cardHeartbeat, {
        type: "UPDATE_CARD",
        description: "Refresh the heartbeat copy.",
      }),
    },
    {
      id: "px-approval-consumed",
      boardId: ids.boardOps,
      cardId: ids.cardApprovalInbox,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenCi,
      agentSessionId: ids.sessionCi,
      kind: "done",
      actionType: "MOVE_CARD",
      summary: "Move “Approval inbox polish” to done",
      risk: "low",
      planHash: hash("consumed"),
      status: "consumed",
      expiresAt: at(-minutes(20)),
      createdAt: at(-hours(1) - minutes(10)),
      decidedBy: admin.id,
      decidedAt: at(-minutes(40)),
      consumedAt: at(-minutes(35)),
      runId: run128,
      plan: approvalPlan(ids.cardApprovalInbox, {
        type: "MOVE_CARD",
        fromColumnId: ids.columnOpsProgress,
        fromIndex: 0,
        toColumnId: ids.columnOpsDone,
        toIndex: 1,
      }),
    },
    {
      id: "px-approval-website",
      boardId: ids.boardSite,
      cardId: ids.cardPricingCopy,
      requestedBy: admin.id,
      requestedByTokenId: ids.tokenDocs,
      agentSessionId: ids.sessionPricing,
      kind: "custom",
      actionType: "UPDATE_CARD",
      summary: "Refresh the Website pricing copy",
      risk: "medium",
      planHash: hash("website"),
      status: "pending",
      expiresAt: at(hours(72)),
      createdAt: at(-minutes(6)),
      plan: {
        commands: [
          {
            commandId: "px-plan-website-pricing",
            action: {
              boardId: ids.boardSite,
              at: now,
              type: "UPDATE_CARD",
              cardId: ids.cardPricingCopy,
              description: "Refresh the Website pricing copy.",
            },
          },
        ],
      },
    },
  ];
  for (const approval of approvals) {
    await prisma.approvalRequest.create({
      data: {
        ...approval,
        plan: approval.plan,
      },
    });
  }
  // Keep the run → approval back-link alongside the approval → run link.
  await prisma.agentRun.update({
    where: { id: run128 },
    data: { approvalId: "px-approval-consumed" },
  });

  // --- sessions ----------------------------------------------------------
  const sessionRows = [
    {
      id: ids.sessionRefactor,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Refactor approval flow",
      clientName: "opencode",
      model: "deepseek-v4.1",
      status: "active",
      currentCardId: ids.cardMcp,
      currentRunId: run108,
      startedAt: at(-hours(2)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Refactoring the approval flow.",
    },
    {
      id: ids.sessionLanding,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Landing page rewrite",
      clientName: "opencode",
      model: "gpt-5.2",
      status: "waiting_approval",
      currentCardId: ids.cardLanding,
      currentRunId: null,
      startedAt: at(-hours(3)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Last known work: landing page rewrite.",
    },
    {
      id: ids.sessionApi,
      userId: admin.id,
      apiTokenId: ids.tokenDocs,
      boardId: ids.boardOps,
      name: "API reference sweep",
      clientName: "terminal",
      model: "claude-haiku-4.5",
      status: "active",
      currentCardId: ids.cardClaim,
      currentRunId: run126,
      startedAt: at(-hours(1) - minutes(20)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Sweeping the API reference.",
    },
    {
      id: ids.sessionRelease,
      userId: member.id,
      apiTokenId: ids.tokenRelease,
      boardId: ids.boardSite,
      name: "Release checklist",
      clientName: "terminal",
      model: "claude-sonnet-4.5",
      status: "waiting_approval",
      currentCardId: ids.cardPricingCopy,
      currentRunId: null,
      startedAt: at(-minutes(58)),
      lastHeartbeatAt: at(-seconds(12)),
      pausedAt: at(-minutes(20)),
      pausedBy: admin.id,
      pausedReason: "Hold until the pricing copy is reviewed.",
      summary: "Paused for the pricing review.",
    },
    {
      id: ids.sessionDeploy,
      userId: admin.id,
      apiTokenId: ids.tokenCi,
      boardId: ids.boardSite,
      name: "Deploy notes",
      clientName: "github-actions",
      model: "gpt-5.2",
      status: "active",
      currentCardId: ids.cardPricingRefs,
      currentRunId: run115,
      startedAt: at(-hours(2)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Waiting for the next deploy.",
    },
    {
      id: ids.sessionPricing,
      userId: admin.id,
      apiTokenId: ids.tokenDocs,
      boardId: ids.boardSite,
      name: "Pricing copy references",
      clientName: "terminal",
      model: "claude-haiku-4.5",
      status: "active",
      currentCardId: ids.cardPricingRefs,
      currentRunId: run112,
      startedAt: at(-minutes(24)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Collecting pricing references.",
    },
    {
      id: ids.sessionIdle,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Idle heartbeat check",
      clientName: "opencode",
      model: "deepseek-v4.1",
      status: "idle",
      currentCardId: null,
      currentRunId: null,
      startedAt: at(-minutes(50)),
      lastHeartbeatAt: at(-seconds(12)),
      summary: "Idle but heartbeating.",
    },
    {
      id: ids.sessionDone,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Compose release notes",
      clientName: "opencode",
      model: "deepseek-v4.1",
      status: "completed",
      currentCardId: null,
      currentRunId: null,
      startedAt: at(-hours(5)),
      lastHeartbeatAt: at(-hours(4)),
      endedAt: at(-hours(4)),
      endReason: "Release notes shipped.",
      summary: "Completed successfully.",
    },
    {
      id: ids.sessionFailed,
      userId: admin.id,
      apiTokenId: ids.tokenDocs,
      boardId: ids.boardSite,
      name: "Docs build",
      clientName: "github-actions",
      model: "gpt-5.2",
      status: "failed",
      currentCardId: null,
      currentRunId: null,
      startedAt: at(-hours(27)),
      lastHeartbeatAt: at(-hours(26)),
      endedAt: at(-hours(26)),
      endReason: "Build failed.",
      summary: "Failed while syncing callouts.",
    },
    {
      id: ids.sessionCancelled,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Archive cleanup",
      clientName: "opencode",
      model: "deepseek-v4.1",
      status: "cancelled",
      currentCardId: null,
      currentRunId: null,
      startedAt: at(-hours(9)),
      lastHeartbeatAt: at(-hours(8)),
      endedAt: at(-hours(8)),
      endReason: "Operator cancelled the cleanup.",
      summary: "Cancelled before any writes.",
    },
    {
      id: ids.sessionStale,
      userId: admin.id,
      apiTokenId: ids.tokenClaude,
      boardId: ids.boardOps,
      name: "Landing page QA",
      clientName: "opencode",
      model: "deepseek-v4.1",
      status: "active",
      currentCardId: ids.cardLanding,
      currentRunId: null,
      startedAt: at(-hours(2)),
      lastHeartbeatAt: at(-minutes(18)),
      summary: "No heartbeat since the last review.",
    },
    {
      id: ids.sessionCi,
      userId: admin.id,
      apiTokenId: ids.tokenCi,
      boardId: ids.boardOps,
      name: "Release notes deploy",
      clientName: "github-actions",
      model: "gpt-5.2",
      status: "completed",
      currentCardId: null,
      currentRunId: run128,
      startedAt: at(-hours(1)),
      lastHeartbeatAt: at(-minutes(35)),
      endedAt: at(-minutes(35)),
      endReason: "Release notes shipped.",
      summary: "Completed successfully.",
    },
  ];
  for (const row of sessionRows) {
    await prisma.agentSession.create({ data: row });
  }

  // The dedicated stale row keeps its real lifecycle (`active`) while the
  // heartbeat reports its age separately; `sessionIdle` stays fresh so it
  // demonstrates Idle for the whole review.

  console.log(
    JSON.stringify(
      {
        ok: true,
        api: API_URL,
        login: {
          admin: "pixel-admin@example.com",
          member: "pixel-member@example.com",
          password: PASSWORD,
        },
        boards: { agentOps: ids.boardOps, website: ids.boardSite },
        runs: {
          plusTwo: run128,
          apiReference: run126,
          reverted: run124,
          conflict: run121,
          failed: run118,
          sixth: run108,
          movedThree: run115,
          notes: run112,
          expired: runExpired,
        },
        tokens: rawTokens,
      },
      null,
      2,
    ),
  );

  // Optional disposable-demo heartbeat: keep the intentionally fresh rows
  // alive without future timestamps. Stop the process to let them age out.
  if (process.env.SEED_KEEP_HEARTBEATS === "1") {
    const freshIds = [
      ids.sessionRefactor,
      ids.sessionLanding,
      ids.sessionApi,
      ids.sessionDeploy,
      ids.sessionPricing,
      ids.sessionIdle,
    ];
    const beat = async () => {
      await prisma.agentSession.updateMany({
        where: { id: { in: freshIds }, endedAt: null },
        data: { lastHeartbeatAt: new Date() },
      });
    };
    await beat();
    await new Promise(() => {
      setInterval(() => {
        void beat().catch((error) =>
          console.error("demo heartbeat failed", error),
        );
      }, 60_000);
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
