import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionDto,
  AuthMeResponseDto,
  BoardSummary,
  UserTokenDto,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useAgentSessionEvents } from "./use-agent-events";
import { useBoard } from "@/store/BoardContext";
import {
  groupAgents,
  type AgentGroup,
  type AgentSessionRow,
} from "./agent-model";

/** How often the console re-reads sessions when no SSE frame arrives. */
const POLL_MS = 30_000;

export interface AgentSessionsState {
  rows: AgentSessionRow[];
  groups: AgentGroup[];
  boards: BoardSummary[];
  tokens: UserTokenDto[];
  me: AuthMeResponseDto | null;
  /** First answer has not arrived: render the skeleton. */
  loading: boolean;
  /** A refresh is in flight while the previous rows stay visible. */
  refreshing: boolean;
  error: boolean;
  errorStatus: number | null;
  /** The caller's own token/session names (a PAT gets `null`). */
  isAgentToken: boolean;
  reload: () => void;
  refreshBoard: (boardId: string) => Promise<void>;
  replaceSession: (session: AgentSessionDto) => void;
  lastLoadedAt: number | null;
  staleBoardIds: string[];
}

/**
 * The agents console data: every board's agent sessions, merged and decorated
 * with board/token/card labels. The server exposes sessions per board only, so
 * the client fans out over the caller's boards (`GET /boards`), then keeps the
 * merged list live with up to four agent event streams and a periodic poll
 * covering every board.
 */
export function useAgentSessions(): AgentSessionsState {
  const serverMode = isApiEnabled();
  const { boards: loadedBoards } = useBoard();
  const [sessions, setSessions] = useState<AgentSessionDto[] | null>(null);
  const [summaries, setSummaries] = useState<BoardSummary[]>([]);
  const [tokens, setTokens] = useState<UserTokenDto[]>([]);
  const [me, setMe] = useState<AuthMeResponseDto | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const failedBoards = useRef(new Set<string>());
  const boardListFailed = useRef(false);
  const [staleBoardIds, setStaleBoardIds] = useState<string[]>([]);
  const summaryRef = useRef<BoardSummary[]>([]);

  const load = useCallback(
    async (kind: "initial" | "refresh"): Promise<void> => {
      if (!serverMode) {
        setSessions([]);
        return;
      }
      if (kind === "refresh") {
        if (inFlight.current) return;
        setRefreshing(true);
      }
      const request = ++generation.current;
      inFlight.current = true;
      try {
        const [nextSummaries, nextTokens, nextMe] = await Promise.all([
          api.listBoards(),
          api.listTokens().catch(() => [] as UserTokenDto[]),
          api.me().catch(() => null),
        ]);
        const results = await boundedSessions(nextSummaries);
        if (request !== generation.current) return;
        const merged: AgentSessionDto[] = [];
        let failures = 0;
        let firstFailureStatus: number | null = null;
        const failed = new Set<string>();
        const revoked = new Set<string>();
        for (const [index, result] of results.entries()) {
          if (result.status === "fulfilled") {
            merged.push(...result.value);
          } else {
            failures += 1;
            const status = statusOf(result.reason);
            if (status === 403 || status === 404) {
              revoked.add(nextSummaries[index].id);
            } else {
              failed.add(nextSummaries[index].id);
            }
            if (firstFailureStatus === null) firstFailureStatus = status;
          }
        }
        boardListFailed.current = false;
        failedBoards.current = failed;
        setStaleBoardIds([...failed]);
        const visible = nextSummaries.filter((board) => !revoked.has(board.id));
        summaryRef.current = visible;
        setSummaries(visible);
        setTokens(nextTokens);
        setMe(nextMe);
        setSessions((current) => {
          // A retry can briefly return the same id for two boards (or keep a
          // stale row beside a fresh one); the list renders by id, so collapse
          // duplicates before they reach React.
          const byId = new Map<string, AgentSessionDto>();
          for (const row of merged) byId.set(row.id, row);
          for (const row of current ?? []) {
            if (failed.has(row.boardId) && !byId.has(row.id)) {
              byId.set(row.id, row);
            }
          }
          return [...byId.values()];
        });
        setError(failures > 0);
        setErrorStatus(firstFailureStatus);
        if (failures === 0) setLastLoadedAt(Date.now());
      } catch (error) {
        if (request !== generation.current) return;
        setError(true);
        boardListFailed.current = true;
        failedBoards.current = new Set(
          summaryRef.current.map((board) => board.id),
        );
        setStaleBoardIds([...failedBoards.current]);
        setErrorStatus(statusOf(error));
      } finally {
        if (request === generation.current) {
          inFlight.current = false;
          setRefreshing(false);
        }
      }
    },
    [serverMode],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first data lands in the async load, not synchronously
    void load("initial");
  }, [load]);

  // Poll all boards periodically and after returning to a sleeping tab.
  useEffect(() => {
    if (!serverMode) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load("refresh");
    }, POLL_MS);
    const onVisible = (): void => {
      if (!document.hidden) void load("refresh");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, serverMode]);

  const refreshBoard = useCallback(
    async (boardId: string): Promise<void> => {
      if (!serverMode) return;
      const request = generation.current;
      try {
        // A brand-new token may not have existed at page load; refresh the
        // small token-name map alongside the affected board so the row shows
        // the agent's name, not only the session's self-chosen label.
        const [next, nextTokens] = await Promise.all([
          api.listAgentSessions(boardId),
          api.listTokens().catch(() => null),
        ]);
        if (request !== generation.current) return;
        setSessions((current) => {
          if (current === null) return current;
          const others = current.filter((row) => row.boardId !== boardId);
          return [...others, ...next];
        });
        if (nextTokens !== null) setTokens(nextTokens);
        failedBoards.current.delete(boardId);
        setStaleBoardIds([...failedBoards.current]);
        if (failedBoards.current.size === 0 && !boardListFailed.current) {
          setError(false);
          setErrorStatus(null);
        }
      } catch (error) {
        if (request !== generation.current) return;
        // A background refresh is best effort: keep the rows but mark them
        // stale so the manual Retry and the poll have a visible reason.
        setError(true);
        const status = statusOf(error);
        if (status === 403 || status === 404) {
          generation.current += 1;
          inFlight.current = false;
          setRefreshing(false);
          summaryRef.current = summaryRef.current.filter(
            (board) => board.id !== boardId,
          );
          failedBoards.current.delete(boardId);
          setSessions(
            (current) =>
              current?.filter((row) => row.boardId !== boardId) ?? current,
          );
          setSummaries((current) =>
            current.filter((board) => board.id !== boardId),
          );
        } else {
          failedBoards.current.add(boardId);
        }
        setStaleBoardIds([...failedBoards.current]);
        setErrorStatus(status);
      }
    },
    [serverMode],
  );

  const replaceSession = useCallback((session: AgentSessionDto): void => {
    if (!summaryRef.current.some((board) => board.id === session.boardId))
      return;
    setSessions((current) => {
      if (current === null) return current;
      const index = current.findIndex((row) => row.id === session.id);
      if (index === -1) {
        // A session that appeared between two reads (the SSE frame was for a
        // board not in the last fan-out) is worth showing immediately.
        return [...current, session];
      }
      const next = [...current];
      next[index] = session;
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    void load("refresh");
  }, [load]);

  // Keep live updates for a bounded number of boards; polling covers the rest.
  const handleAccessLost = useCallback((boardId: string) => {
    // Invalidate in-flight fan-outs so they cannot restore revoked rows.
    generation.current += 1;
    inFlight.current = false;
    setRefreshing(false);
    summaryRef.current = summaryRef.current.filter(
      (board) => board.id !== boardId,
    );
    setSummaries(summaryRef.current);
    setSessions(
      (current) => current?.filter((row) => row.boardId !== boardId) ?? current,
    );
    failedBoards.current.delete(boardId);
    setStaleBoardIds([...failedBoards.current]);
    setError(true);
    setErrorStatus(403);
  }, []);

  const liveBoards = useMemo(
    () => summaries.slice(0, 4).map((board) => board.id),
    [summaries],
  );
  useAgentSessionEvents(
    liveBoards,
    (boardId) => {
      void refreshBoard(boardId);
    },
    serverMode,
    handleAccessLost,
  );

  const cardTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const board of loadedBoards) {
      for (const card of Object.values(board.cards))
        map.set(card.id, card.title);
    }
    return map;
  }, [loadedBoards]);

  const rows = useMemo<AgentSessionRow[]>(() => {
    if (sessions === null) return [];
    const boardById = new Map(summaries.map((board) => [board.id, board]));
    const tokenById = new Map(tokens.map((token) => [token.id, token.name]));
    return sessions.map((session) => {
      const board = boardById.get(session.boardId);
      return {
        ...session,
        boardTitle: board?.title ?? session.boardId,
        boardRole: board?.role ?? "VIEWER",
        cardTitle:
          session.currentCardId === null
            ? null
            : (cardTitles.get(session.currentCardId) ?? null),
        tokenName: tokenById.get(session.apiTokenId) ?? null,
        // `listTokens` is session-only and returns the caller's own keys;
        // presence in the map is therefore an ownership check, not a name
        // fallback. Other members' token names stay hidden.
        isOwnToken: tokenById.has(session.apiTokenId),
      };
    });
  }, [cardTitles, sessions, summaries, tokens]);

  const groups = useMemo(() => groupAgents(rows), [rows]);

  return {
    rows,
    groups,
    boards: summaries,
    tokens,
    me,
    loading: sessions === null && error === false,
    refreshing,
    error,
    errorStatus,
    isAgentToken: me?.token != null,
    reload,
    refreshBoard,
    replaceSession,
    lastLoadedAt,
    staleBoardIds,
  };
}

/** `ApiError` status without importing the class into every caller. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

// Limit simultaneous requests for accounts with many boards.
async function boundedSessions(
  boards: BoardSummary[],
): Promise<PromiseSettledResult<AgentSessionDto[]>[]> {
  const results: PromiseSettledResult<AgentSessionDto[]>[] = new Array(
    boards.length,
  );
  let index = 0;
  async function worker(): Promise<void> {
    while (index < boards.length) {
      const current = index++;
      try {
        results[current] = {
          status: "fulfilled",
          value: await api.listAgentSessions(boards[current].id),
        };
      } catch (reason) {
        results[current] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, boards.length) }, () => worker()),
  );
  return results;
}
