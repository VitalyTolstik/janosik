// Version 1 of the canonical TASK-176 fixture. The pixel seed uses these
// definitions for the shared scene and the verifier checks the final rows.
export const ids = {
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
  cardRetention: "px-card-expired-retention",
};

const users = [
  {
    id: ids.userAdmin,
    email: "pixel-admin@example.com",
    displayName: "Audit Admin",
    locale: "en",
    emailVerifiedAt: true,
    disabledAt: null,
  },
  {
    id: ids.userMember,
    email: "pixel-member@example.com",
    displayName: "Riley Member",
    locale: "en",
    emailVerifiedAt: true,
    disabledAt: null,
  },
];

const boards = [
  {
    id: ids.boardOps,
    title: "Agent Ops Demo",
    archivedAt: null,
    deletedAt: null,
  },
  {
    id: ids.boardSite,
    title: "Website Relaunch",
    archivedAt: null,
    deletedAt: null,
  },
];

const members = [
  ["ops-admin", ids.boardOps, ids.userAdmin, "ADMIN"],
  ["site-admin", ids.boardSite, ids.userAdmin, "MEMBER"],
  ["ops-member", ids.boardOps, ids.userMember, "MEMBER"],
  ["site-member", ids.boardSite, ids.userMember, "ADMIN"],
].map(([suffix, boardId, userId, role]) => ({
  id: `px-board-member-${suffix}`,
  boardId,
  userId,
  role,
  acceptedAt: true,
  expiresAt: null,
  invitedById: null,
}));

const columns = [
  [
    ids.boardOps,
    ids.columnOpsBacklog,
    ids.columnOpsProgress,
    ids.columnOpsReview,
    ids.columnOpsDone,
  ],
  [
    ids.boardSite,
    ids.columnSiteBacklog,
    ids.columnSiteProgress,
    ids.columnSiteReview,
    ids.columnSiteDone,
  ],
].flatMap(([boardId, ...columnIds]) =>
  columnIds.map((id, position) => ({
    id,
    boardId,
    title: ["Backlog", "In progress", "Review", "Done"][position],
    position,
    deletedAt: null,
  })),
);

const cards = [
  [
    ids.cardClaim,
    ids.columnOpsBacklog,
    0,
    "Card claim visibility",
    "API reference sweep — exact MCP transport contract.",
  ],
  [
    ids.cardOnboarding,
    ids.columnOpsBacklog,
    1,
    "Old onboarding draft",
    null,
    true,
  ],
  [ids.cardApprovalInbox, ids.columnOpsDone, 1, "Approval inbox polish"],
  [
    ids.cardMcp,
    ids.columnOpsProgress,
    0,
    "MCP write contract",
    "Approval inbox copy reviewed after the docs build.",
  ],
  [ids.cardHeartbeat, ids.columnOpsReview, 0, "Session heartbeat copy"],
  [
    ids.cardLanding,
    ids.columnOpsReview,
    1,
    "Landing page rewrite — final",
    "Final landing page copy with the annual toggle.",
  ],
  [
    ids.cardMcpCallouts,
    ids.columnOpsDone,
    0,
    "MCP callouts",
    "MCP callouts — failed mid-sync.",
  ],
  [ids.cardPricingCopy, ids.columnSiteDone, 3, "Pricing page copy"],
  [ids.cardPricingRefs, ids.columnSiteDone, 2, "Pricing copy references"],
  [ids.cardReleaseNotes, ids.columnSiteDone, 1, "Release notes"],
  [ids.cardApiReference, ids.columnSiteDone, 0, "API reference"],
  [
    ids.cardDocsIndex,
    ids.columnSiteBacklog,
    0,
    "Docs index",
    "API notes from the MCP transport review.",
  ],
  [ids.cardRetention, ids.columnSiteBacklog, 1, "Retention sample"],
].map(
  ([id, columnId, position, title, description = null, deletedAt = null]) => ({
    id,
    columnId,
    position,
    title,
    description,
    deletedAt,
    priority: null,
    assigneeId: null,
    coverType: null,
    coverValue: null,
    dueDate: null,
    acceptanceCriteria: [],
    definitionOfDone: [],
    claimedBy: null,
    claimedByTokenId: null,
    claimedBySessionId: null,
    leaseUntil: null,
    archivedAt: null,
    archivedFromColumnId: null,
    attachmentCount: 0,
  }),
);

const labelId = "px-label-task176-demo";
const checklistId = "px-checklist-task176-demo";

export const relations = {
  label: [
    {
      id: labelId,
      boardId: ids.boardOps,
      name: "TASK-176 demo",
      color: "pink",
      position: 0,
      deletedAt: null,
    },
  ],
  cardLabel: [{ cardId: ids.cardClaim, labelId, position: 0 }],
  checklist: [
    {
      id: checklistId,
      cardId: ids.cardClaim,
      title: "TASK-176 acceptance",
      position: 0,
      deletedAt: null,
    },
  ],
  checklistItem: [
    ["one", "Label chips render in admin card detail"],
    ["two", "Checklist progress shows 1/3"],
    ["three", "Relations panel lists the linked card"],
  ].map(([suffix, text], position) => ({
    id: `px-checkitem-task176-${suffix}`,
    checklistId,
    text,
    position,
    done: true,
    deletedAt: null,
  })),
  cardLink: [
    ["px-link-task176-demo", ids.cardMcp, "relates_to"],
    ["px-link-task176-blocks", ids.cardApprovalInbox, "blocks"],
  ].map(([id, toCardId, type], position) => ({
    id,
    boardId: ids.boardOps,
    fromCardId: ids.cardClaim,
    toCardId,
    type,
    position,
    deletedAt: null,
  })),
};

export const manifest = {
  version: 1,
  rows: {
    user: users,
    board: boards,
    boardMember: members,
    column: columns,
    card: cards,
    ...relations,
    // Includes soft-deleted rows. The 60 t176-comment-* rows are TASK-176.9
    // manual scaffolding and there is no comment fixture in this reset.
    comment: [],
    attachment: [],
  },
  liveCards: 12,
  outOfFixture: [
    "Command",
    "CommandPreimage",
    "Activity",
    "AgentRun",
    "AgentSession",
    "ApprovalRequest",
    "ApiToken",
    "AttentionNotification",
    "NotificationMail",
    "RefreshToken",
    "EmailChangeCode",
    "EmailVerificationCode",
    "PasswordResetToken",
    "OAuthIdentity",
    "BoardShare",
    "BoardShareAuditLog",
    "BoardShareSnapshotBlob",
    "BoardShareSnapshotComment",
    "DemoRun",
    "DataExport",
    "SecurityAuditLog",
    "IdempotencyRecord",
    "ReminderSent",
    "AdminAuditLog",
    "AdminRefreshToken",
    "AdminUser",
    "AnnouncementDismissal",
  ],
};
