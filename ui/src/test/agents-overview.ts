import type {
  AgentsOverviewApprovalItem,
  AgentsOverviewApprovalsResponse,
  BoardRole,
} from "@janosik/shared";

export interface OverviewBoard {
  id: string;
  title: string;
  role: BoardRole;
}

export const OVERVIEW_BOARDS: readonly OverviewBoard[] = [
  { id: "board-1", title: "Launch", role: "ADMIN" },
  { id: "board-2", title: "Docs", role: "MEMBER" },
];

/** One effective approval row as the aggregation endpoint returns it. */
export function overviewItem(
  overrides: Partial<AgentsOverviewApprovalItem> = {},
): AgentsOverviewApprovalItem {
  const now = Date.now();
  const status = overrides.status ?? "pending";
  return {
    id: "approval-1",
    boardId: "board-1",
    cardId: "card-1",
    requestedBy: "user-1",
    requestedByTokenId: "token-1",
    agentSessionId: "session-1",
    kind: "destructive",
    actionType: "DELETE_CARD",
    summary: "Delete card “Card claim visibility”",
    risk: "medium",
    planHash:
      "da83a7614519e38b98dfa916c737f3a7e8a40c74328962e486487fdd511a0eb1",
    status,
    storedStatus: overrides.storedStatus ?? status,
    expiresAt: now + 30 * 60_000,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    runId: null,
    consumedAt: null,
    createdAt: now - 5 * 60_000,
    boardTitle: "Launch",
    boardRole: "ADMIN",
    cardTitle: "Card claim visibility",
    sessionName: "Nightly triage",
    tokenName: "QA agent",
    requestedByName: "UX Agent Audit",
    requestedByEmail: "ux@example.com",
    decidedByName: null,
    commandCount: 1,
    operationCount: 0,
    ...overrides,
  };
}

export interface OverviewResponseOptions {
  /** `null`/omitted = All boards. */
  boardId?: string | null;
  boards?: readonly OverviewBoard[];
  /** Exact pending counts, including boards outside the selected scope. */
  pendingByBoard?: Readonly<Record<string, number>>;
  /** Exact pending count for the selected scope. */
  pendingTotal?: number;
  totalApprovals?: number;
  /** Matching rows after filters, before the page limit. */
  total?: number;
  canViewApprovals?: boolean;
  refreshedAt?: number;
}

export function overviewResponse(
  items: AgentsOverviewApprovalItem[] = [],
  options: OverviewResponseOptions = {},
): AgentsOverviewApprovalsResponse {
  const boards = options.boards ?? OVERVIEW_BOARDS;
  const boardId = options.boardId ?? null;
  const scoped =
    boardId === null ? boards : boards.filter((board) => board.id === boardId);
  const selected = boardId === null ? null : (scoped[0] ?? null);
  const pendingOn = (id: string): number =>
    options.pendingByBoard?.[id] ??
    items.filter((item) => item.boardId === id && item.status === "pending")
      .length;
  const adminScoped = scoped.filter((board) => board.role === "ADMIN");
  const pending =
    options.pendingTotal ??
    (selected === null
      ? adminScoped.reduce((sum, board) => sum + pendingOn(board.id), 0)
      : selected.role === "ADMIN"
        ? pendingOn(selected.id)
        : 0);
  const totalApprovals = options.totalApprovals ?? items.length;
  return {
    section: "approvals",
    scope: {
      boardId,
      boardTitle: selected?.title ?? null,
      role: selected?.role ?? null,
      canViewApprovals: options.canViewApprovals ?? adminScoped.length > 0,
    },
    items,
    nextCursor: null,
    total: options.total ?? items.length,
    counts: {
      boards: boards.map((board) => ({
        id: board.id,
        title: board.title,
        role: board.role,
        pendingApprovals: board.role === "ADMIN" ? pendingOn(board.id) : null,
      })),
      approvals: {
        pending,
        decided: Math.max(0, totalApprovals - pending),
        total: totalApprovals,
      },
      sessions: {
        total: 0,
        live: 0,
        active: 0,
        idle: 0,
        waiting: 0,
        stale: 0,
        paused: 0,
      },
      runs: { total: 0, applied: 0, reverted: 0, failed: 0 },
    },
    facets: {
      tokens: [],
      sessions: [],
      tokensTruncated: false,
      sessionsTruncated: false,
    },
    refreshedAt: options.refreshedAt ?? Date.now(),
  };
}
