import type {
  AgentSessionDto,
  AgentSessionStatus,
  BoardRole,
  UserTokenDto,
} from "@janosik/shared";

/** One session plus the board/token labels the agents console renders. */
export interface AgentSessionRow extends AgentSessionDto {
  boardTitle: string;
  boardRole: BoardRole;
  /** Card title when the open board aggregate is hydrated; null otherwise. */
  cardTitle: string | null;
  /** The caller's own token name; null for another member's token. */
  tokenName: string | null;
  /**
   * True only when `apiTokenId` belongs to the caller. Token settings and
   * token-level controls are owner-only; a board admin must not be offered
   * a link into somebody else's Account surface.
   */
  isOwnToken: boolean;
}

export type AgentStatusFilter = "all" | "live" | "stale" | AgentSessionStatus;

/** The `/agents` Sessions grouping switch. Board-first is the default. */
export type AgentGroupMode = "board" | "token";

export const AGENT_GROUP_MODES: AgentGroupMode[] = ["board", "token"];

export type AgentTimeFilter = "any" | "1h" | "24h" | "7d" | "30d";

export interface AgentFilter {
  board: string;
  token: string;
  status: AgentStatusFilter;
  time: AgentTimeFilter;
  query: string;
}

export const EMPTY_AGENT_FILTER: AgentFilter = {
  board: "all",
  token: "all",
  status: "all",
  time: "any",
  query: "",
};

export const AGENT_STATUS_FILTERS: AgentStatusFilter[] = [
  "all",
  "live",
  "stale",
  "active",
  "idle",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
];

export const AGENT_TIME_FILTERS: AgentTimeFilter[] = [
  "any",
  "1h",
  "24h",
  "7d",
  "30d",
];

/** URL ⇄ filter mapping, shared by the page and its tests. */
export function readAgentFilter(params: URLSearchParams): AgentFilter {
  const status = params.get("status");
  const time = params.get("time");
  return {
    board: params.get("board") ?? "all",
    token: params.get("agent") ?? params.get("token") ?? "all",
    status:
      status !== null && (AGENT_STATUS_FILTERS as string[]).includes(status)
        ? (status as AgentStatusFilter)
        : "all",
    time:
      time !== null && (AGENT_TIME_FILTERS as string[]).includes(time)
        ? (time as AgentTimeFilter)
        : "any",
    query: params.get("q") ?? "",
  };
}

/** `?group=token` is additive; an absent or unknown value means board-first. */
export function readAgentGroup(params: URLSearchParams): AgentGroupMode {
  return params.get("group") === "token" ? "token" : "board";
}

/**
 * Compact age used by the heartbeat column (`12s`, `6m`, `3h`, `2d`).
 * `Intl.RelativeTimeFormat` is deliberately not used here: the prototype's
 * heartbeat cell is a dense two-word signal, not a sentence.
 */
export function compactAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Heartbeat age in ms; never negative even if a clock skews backwards. */
export function heartbeatAge(session: AgentSessionDto, now: number): number {
  return Math.max(0, now - session.lastHeartbeatAt);
}

/**
 * The visual tone of a real lifecycle status. `stale` and `paused` are not
 * members of this union: they are computed liveness/pause fields and must be
 * rendered beside the lifecycle, never instead of it.
 */
export type AgentStatusTone = "ok" | "warn" | "bad" | "primary" | "muted";

export function agentStatusTone(status: AgentSessionStatus): AgentStatusTone {
  switch (status) {
    case "active":
      return "ok";
    case "waiting_approval":
      return "warn";
    case "failed":
      return "bad";
    case "completed":
      return "primary";
    case "idle":
    case "cancelled":
      return "muted";
  }
}

/** The default live window is deliberately generous: a swarm may idle. */
export const AGENT_TIME_WINDOWS_MS: Record<
  Exclude<AgentTimeFilter, "any">,
  number
> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function isTerminalStatus(status: AgentSessionStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

/** A session the control plane still considers open. */
export function isLiveSession(session: AgentSessionDto): boolean {
  return session.endedAt === null && !isTerminalStatus(session.status);
}

/** The last moment the session showed life (heartbeat or its end). */
export function lastSeenAt(session: AgentSessionDto): number {
  return Math.max(session.lastHeartbeatAt, session.endedAt ?? 0);
}

export function agentLabel(row: AgentSessionRow): string {
  return (
    row.tokenName ??
    row.name ??
    row.clientName ??
    `Agent ${row.apiTokenId.slice(0, 8)}`
  );
}

/**
 * Client-side filter of one session. The server has no global session index,
 * so the console lists every board the caller can see and narrows the merged
 * rows here; the logic is pure so the filter contract is unit-testable.
 */
export function matchesAgentFilter(
  row: AgentSessionRow,
  filter: AgentFilter,
  now: number,
): boolean {
  if (filter.board !== "all" && row.boardId !== filter.board) return false;
  if (filter.token !== "all" && row.apiTokenId !== filter.token) return false;
  if (filter.status === "live" && !isLiveSession(row)) return false;
  if (filter.status === "stale" && !row.stale) return false;
  if (
    filter.status !== "all" &&
    filter.status !== "live" &&
    filter.status !== "stale" &&
    row.status !== filter.status
  ) {
    return false;
  }
  if (filter.time !== "any") {
    const cutoff = now - AGENT_TIME_WINDOWS_MS[filter.time];
    if (lastSeenAt(row) < cutoff) return false;
  }
  const query = filter.query.trim().toLowerCase();
  if (query === "") return true;
  const haystack = [
    row.tokenName,
    row.name,
    row.clientName,
    row.model,
    row.boardTitle,
    row.cardTitle,
    row.apiTokenId,
    row.id,
    row.currentRunId,
    row.summary,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export interface AgentGroup {
  tokenId: string;
  name: string;
  rows: AgentSessionRow[];
  liveCount: number;
  waitingCount: number;
  lastSeen: number;
  boardIds: string[];
}

/**
 * Group the filtered sessions by agent token: one row is one agent, and its
 * detail page lists the individual sessions. A token may run one session per
 * board at a time, so grouping by token keeps two PATs of the same account
 * distinguishable (the TASK-166 core requirement).
 */
export function groupAgents(rows: AgentSessionRow[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const row of rows) {
    const existing = groups.get(row.apiTokenId);
    if (existing === undefined) {
      groups.set(row.apiTokenId, {
        tokenId: row.apiTokenId,
        name: agentLabel(row),
        rows: [row],
        liveCount: isLiveSession(row) ? 1 : 0,
        waitingCount: row.status === "waiting_approval" ? 1 : 0,
        lastSeen: lastSeenAt(row),
        boardIds: [row.boardId],
      });
      continue;
    }
    existing.rows.push(row);
    if (isLiveSession(row)) existing.liveCount += 1;
    if (row.status === "waiting_approval") existing.waitingCount += 1;
    existing.lastSeen = Math.max(existing.lastSeen, lastSeenAt(row));
    if (!existing.boardIds.includes(row.boardId)) {
      existing.boardIds.push(row.boardId);
    }
    // A newer row carries the freshest token/session name snapshot.
    if (lastSeenAt(row) >= existing.lastSeen) existing.name = agentLabel(row);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.liveCount - a.liveCount ||
      b.waitingCount - a.waitingCount ||
      b.lastSeen - a.lastSeen ||
      a.name.localeCompare(b.name),
  );
}

/** The most recently seen live session of a group, for the list summary. */
export function latestLiveSession(
  group: AgentGroup,
): AgentSessionRow | undefined {
  return group.rows
    .filter(isLiveSession)
    .sort((a, b) => lastSeenAt(b) - lastSeenAt(a))[0];
}

export function tokenNameMap(tokens: UserTokenDto[]): Map<string, string> {
  return new Map(tokens.map((token) => [token.id, token.name]));
}

/** Short id for dense rows; the full value stays in the title attribute. */
export function shortId(id: string, length = 8): string {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

/** `run-128` → `128`, so the dense label reads `Run #128`. */
export function runNumber(id: string): string {
  return id.replace(/^run-/, "");
}
