import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionDto,
  AuthMeResponseDto,
  BoardSummary,
  UserTokenDto,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useBoard } from "@/store/BoardContext";
import {
  groupAgents,
  type AgentGroup,
  type AgentSessionRow,
} from "./agent-model";
import { useAgentSessionEvents } from "./use-agent-events";

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
}

/**
 * The agents console data: every board's agent sessions, merged and decorated
 * with board/token/card labels. The server exposes sessions per board only, so
 * the client fans out over the caller's boards (`GET /boards`), then keeps the
 * merged list live through the agent lifecycle SSE frames and a slow poll.
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
        const results = await Promise.allSettled(
          nextSummaries.map((board) => api.listAgentSessions(board.id)),
        );
        if (request !== generation.current) return;
        const merged: AgentSessionDto[] = [];
        let failures = 0;
        let firstFailureStatus: number | null = null;
        for (const result of results) {
          if (result.status === "fulfilled") {
            merged.push(...result.value);
          } else {
            failures += 1;
            const status = statusOf(result.reason);
            if (firstFailureStatus === null) firstFailureStatus = status;
          }
        }
        // One board failing (a membership that just expired, a deleted
        // board) must not blank a healthy list; only a total failure is an
        // error the user has to see.
        if (failures > 0 && failures === results.length) {
          setError(true);
          setErrorStatus(firstFailureStatus);
          return;
        }
        setSummaries(nextSummaries);
        setTokens(nextTokens);
        setMe(nextMe);
        setSessions(merged);
        setError(false);
        setErrorStatus(null);
        setLastLoadedAt(Date.now());
      } catch (error) {
        if (request !== generation.current) return;
        setError(true);
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

  // Visibility-driven and periodic fallback: agent frames are live-only, so a
  // tab that slept through one still reconciles without a reload.
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
      try {
        // A brand-new token may not have existed at page load; refresh the
        // small token-name map alongside the affected board so the row shows
        // the agent's name, not only the session's self-chosen label.
        const [next, nextTokens] = await Promise.all([
          api.listAgentSessions(boardId),
          api.listTokens().catch(() => null),
        ]);
        setSessions((current) => {
          if (current === null) return current;
          const others = current.filter((row) => row.boardId !== boardId);
          return [...others, ...next];
        });
        if (nextTokens !== null) setTokens(nextTokens);
        setLastLoadedAt(Date.now());
        setError(false);
        setErrorStatus(null);
      } catch (error) {
        // A background refresh is best effort: keep the rows but mark them
        // stale so the manual Retry and the poll have a visible reason.
        setError(true);
        setErrorStatus(statusOf(error));
      }
    },
    [serverMode],
  );

  const replaceSession = useCallback((session: AgentSessionDto): void => {
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
    setLastLoadedAt(Date.now());
  }, []);

  const reload = useCallback(() => {
    void load("refresh");
  }, [load]);

  const boardIds = useMemo(
    () => summaries.map((summary) => summary.id),
    [summaries],
  );
  useAgentSessionEvents(
    boardIds,
    (boardId) => {
      void refreshBoard(boardId);
    },
    serverMode,
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
