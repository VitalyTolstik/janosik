import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChevronRight,
  Clock,
  Folder,
  History,
  Inbox,
  Info,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { isApiEnabled } from "@/api/client";
import {
  AGENT_STATUS_FILTERS,
  agentLabel,
  isLiveSession,
  isSessionPaused,
  matchesAgentFilter,
  needsNudge,
  readAgentFilter,
  readAgentGroup,
  shortId,
  shortTokenId,
  type AgentFilter,
  type AgentSessionRow,
  type AgentStatusFilter,
} from "./agent-model";
import {
  HeartbeatText,
  SessionDetail,
  SessionGroupList,
  SessionRow,
  SessionTableHeader,
  groupSessionRows,
} from "./session-ui";
import { useAgentSessions } from "./use-agent-sessions";
import { usePendingApprovals } from "./use-pending-approvals";
import { useAgentRuns } from "./use-agent-runs";
import {
  AttentionApprovalDetail,
  AttentionApprovalList,
  type AttentionApprovalFilter,
  type AttentionApprovalRow,
} from "./AttentionApprovals";
import { BoardScopeSelect } from "./BoardScopeSelect";
import { RunDetail, RunList } from "./run-ui";
import { useRunConflictPreviews } from "./use-run-conflict-previews";
import {
  EMPTY_RUN_FILTER,
  hasRunFilter,
  readRunFilter,
  runBoardRole as roleForRunBoard,
  runFilterOptions,
  writeRunFilter,
  type AgentRunFilter,
  type RunKindFilter,
  type RunStatusFilter,
  type RunTimeFilter,
} from "./run-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useBoard } from "@/store/BoardContext";
import { cn } from "@/lib/utils";
import { boardColor } from "@/utils/board-color";
import { agentRollbackDocsUrl, docsUrl } from "@/utils/docs-url";
import { effectiveApprovalStatus } from "@/utils/approval";

type Section = "attention" | "sessions" | "runs";
const SECTIONS = ["attention", "sessions", "runs"] as const;

/** Toolbar select trigger, matching the prototype `.select` control. */
const TOOLBAR_SELECT_CLASS =
  "min-h-11 w-auto min-w-0 gap-[6px] rounded-[5px] border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] text-[11px] max-md:gap-1 max-md:px-[5px] md:h-7 md:min-h-7";

/** Prototype `.btn-sm`: 28 px high, 11 px / 650, 6 px radius. */
const SMALL_BUTTON_CLASS =
  "h-7 min-h-0 gap-[6px] rounded-[6px] px-[9px] py-0 text-[11px] leading-none font-[650]";
const SMALL_OUTLINE_CLASS = `${SMALL_BUTTON_CLASS} !bg-[color-mix(in_oklab,var(--surface)_65%,transparent)]`;
const SMALL_PRIMARY_CLASS = `${SMALL_BUTTON_CLASS} !bg-[var(--agent-primary-strong)] hover:!bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)]`;

export function AgentsPage() {
  const { t, lang } = useI18n();
  const verticalRail = useMediaQuery("(min-width: 768px)");
  const pageRef = useRef<HTMLElement | null>(null);
  const [params, setParams] = useSearchParams();
  const state = useAgentSessions();
  const { boards: loadedBoards } = useBoard();
  const allDetailScope = params.get("scope") === "all";
  const filter = useMemo(
    () => ({
      ...readAgentFilter(params),
      ...(allDetailScope ? { board: "all" } : {}),
    }),
    [params, allDetailScope],
  );
  const runFilter = useMemo(
    () => ({
      ...readRunFilter(params),
      ...(allDetailScope ? { board: "all" } : {}),
    }),
    [params, allDetailScope],
  );
  const groupMode = readAgentGroup(params);
  const sectionParam = params.get("section");
  const section: Section = SECTIONS.includes(sectionParam as Section)
    ? (sectionParam as Section)
    : "attention";
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [approvalIntent, setApprovalIntent] = useState<"reject" | null>(null);
  const [runConflicts, setRunConflicts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [autoRunId, setAutoRunId] = useState<string | null>(null);
  const [runVisibleCount, setRunVisibleCount] = useState(7);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t("agents.title")} — Janosik`;
    return () => {
      document.title = previous;
    };
  }, [t]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const setFilter = useCallback(
    (patch: Partial<AgentFilter>) => {
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const next = { ...readAgentFilter(search), ...patch };
          setOrDelete(search, "board", next.board, "all");
          if ("board" in patch) search.delete("scope");
          if ("token" in patch) {
            // `?agent=` is canonical; the old `?token=` spelling stays readable
            // but a filter change normalises the URL to the new name.
            setOrDelete(search, "agent", next.token, "all");
            search.delete("token");
            search.delete("session");
          }
          setOrDelete(search, "status", next.status, "all");
          setOrDelete(search, "time", next.time, "any");
          setOrDelete(search, "q", next.query, "");
          // A filter change can hide the selected row; closing every detail
          // avoids an orphaned master-detail pane and lets Attention fall
          // back to the first pending request in the new scope.
          search.delete("session");
          search.delete("approval");
          search.delete("run");
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setRunFilter = useCallback(
    (patch: Partial<AgentRunFilter>) => {
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const next = { ...readRunFilter(search), ...patch };
          writeRunFilter(search, next);
          if ("board" in patch) search.delete("scope");
          search.set("section", "runs");
          search.delete("run");
          search.delete("approval");
          if ("board" in patch) search.delete("session");
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const clearRunFilters = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of [
          "agent",
          "token",
          "status",
          "kind",
          "time",
          "session",
          "q",
          "run",
          "approval",
        ]) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  const openRun = useCallback(
    (run: { id: string; boardId: string }) => {
      setAutoRunId(run.id);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("section", "runs");
          if (!current.has("board") || current.get("scope") === "all")
            next.set("scope", "all");
          next.set("board", run.boardId);
          next.set("run", run.id);
          next.delete("approval");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const closeRun = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("run");
        if (next.get("scope") === "all") {
          next.delete("scope");
          next.delete("board");
        }
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  const openRunSession = useCallback(
    (sessionId: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("section", "sessions");
          next.set("session", sessionId);
          next.delete("run");
          next.delete("approval");
          // The caller comes from the Runs section: its status/kind/time are
          // run filters, not session filters.
          next.delete("status");
          next.delete("kind");
          next.delete("time");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setGroupMode = (mode: "board" | "token") => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        setOrDelete(next, "group", mode, "board");
        return next;
      },
      { replace: true },
    );
  };
  const openSession = useCallback(
    (row: AgentSessionRow) => {
      // Keep the current tab: a session opened from Attention stays on
      // Attention and renders in the shared right-hand detail panel.
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("section", section);
        next.set("session", row.id);
        next.delete("approval");
        next.delete("run");
        return next;
      });
    },
    [section, setParams],
  );
  const closeSession = useCallback(() => {
    // Opening pushes one entry; closing replaces it so Back still leaves the
    // detail instead of re-opening the panel.
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("session");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  const setSection = (value: Section) => {
    setParams((current) => {
      const search = new URLSearchParams(current);
      setOrDelete(search, "section", value, "attention");
      // Section switches close a detail selection, but board/token filters
      // stay in the URL: `agent`/`token` both name the token filter.
      if (search.get("scope") === "all") {
        search.delete("scope");
        search.delete("board");
      }
      for (const key of ["session", "approval", "run"]) search.delete(key);
      // Normalise values that belong to the other section so the URL never
      // claims a filter the visible list is not applying.
      if (value === "runs") {
        writeRunFilter(search, readRunFilter(search));
      } else if (section === "runs") {
        // Run status/kind/time values are not session filters; `failed`
        // overlaps by name but means a failed run, not a failed session.
        search.delete("status");
        search.delete("kind");
        search.delete("time");
      } else {
        const next = readAgentFilter(search);
        setOrDelete(search, "status", next.status, "all");
        setOrDelete(search, "time", next.time, "any");
        search.delete("kind");
      }
      return search;
    });
  };

  const openApproval = useCallback(
    (row: AttentionApprovalRow, mode: "reject" | null = null) => {
      setApprovalIntent(mode);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("section", "attention");
          if (!current.has("board") || current.get("scope") === "all")
            next.set("scope", "all");
          next.set("board", row.boardId);
          next.set("approval", row.id);
          next.delete("session");
          next.delete("run");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const closeApproval = useCallback(() => {
    setApprovalIntent(null);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("approval");
        if (next.get("scope") === "all") {
          next.delete("scope");
          next.delete("board");
        }
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const onSectionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = SECTIONS.indexOf(section);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? SECTIONS.length - 1
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? (current + 1) % SECTIONS.length
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? (current + SECTIONS.length - 1) % SECTIONS.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setSection(SECTIONS[next]);
    document.getElementById(`agents-tab-${SECTIONS[next]}`)?.focus();
  };

  const clearFilters = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of [
          "board",
          "scope",
          "token",
          "agent",
          "status",
          "time",
          "q",
          "session",
          "approval",
          "run",
        ]) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const hasAdminBoard = state.boards.some((board) => board.role === "ADMIN");
  const isAttentionAdmin =
    filter.board === "all"
      ? hasAdminBoard
      : state.boards.find((board) => board.id === filter.board)?.role ===
        "ADMIN";
  // A board-scoped URL can point at a board where the caller is only a
  // MEMBER. Approvals stay unavailable there, but the rail still shows the
  // caller's cross-board pending counts from the ADMIN boards they can read.
  const needsCrossBoardCounts =
    filter.board !== "all" && !isAttentionAdmin && hasAdminBoard;
  const crossBoardPending = usePendingApprovals({
    boardId: null,
    boards: state.boards,
    enabled: !state.isAgentToken && needsCrossBoardCounts,
  });
  const pending = usePendingApprovals({
    boardId: filter.board === "all" ? null : filter.board,
    boards: state.boards,
    enabled: !state.isAgentToken,
  });
  const pendingCounts = needsCrossBoardCounts
    ? crossBoardPending.counts
    : pending.counts;
  const pendingAll = needsCrossBoardCounts
    ? crossBoardPending.totalCount
    : pending.totalCount;
  const runs = useAgentRuns(state.boards, {
    enabled: !state.isAgentToken,
    boardsLoading: state.loading,
    filter: runFilter,
  });
  const countFilter = useMemo(
    () => ({ ...EMPTY_RUN_FILTER, board: filter.board }),
    [filter.board],
  );
  const runCount = useAgentRuns(state.boards, {
    enabled: !state.isAgentToken,
    boardsLoading: state.loading,
    filter: countFilter,
  });
  const {
    loading: countLoading,
    loadingMore: countLoadingMore,
    hasMore: countHasMore,
    error: countError,
    loadMore: loadMoreCount,
  } = runCount;
  useEffect(() => {
    if (!countLoading && !countLoadingMore && countHasMore && !countError)
      void loadMoreCount();
  }, [countLoading, countLoadingMore, countHasMore, countError, loadMoreCount]);
  useEffect(() => {
    // A new filter starts at the mockup's first page of seven.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the visible page on filter change
    setRunVisibleCount(7);
  }, [
    runFilter.board,
    runFilter.kind,
    runFilter.session,
    runFilter.status,
    runFilter.time,
    runFilter.token,
  ]);
  const visibleRunRows = useMemo(
    () => runs.rows.slice(0, runVisibleCount),
    [runVisibleCount, runs.rows],
  );
  // The list must surface rollback blockers before a run is opened. Previews
  // are read-only; the detail's own preview wins when both have an answer.
  const precomputedConflicts = useRunConflictPreviews(
    section === "runs" ? visibleRunRows : [],
    section === "runs",
  );
  const displayedConflicts = useMemo(
    () => new Map([...precomputedConflicts, ...runConflicts]),
    [precomputedConflicts, runConflicts],
  );
  // The master-detail opens the newest run until the URL pins one. Remember
  // which run that was so a refresh that prepends the new `revert` audit run
  // does not steal the open pane. A filter/no-rows change falls back again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember the auto-opened run across list refreshes
    setAutoRunId((current) =>
      section !== "runs"
        ? null
        : current !== null && runs.rows.some((row) => row.id === current)
          ? current
          : (runs.rows[0]?.id ?? null),
    );
  }, [section, runs.rows]);
  const [approvalFilter, setApprovalFilter] =
    useState<AttentionApprovalFilter>("needs");
  const changeApprovalFilter = useCallback(
    (next: AttentionApprovalFilter) => {
      setApprovalFilter(next);
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          search.delete("approval");
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const approvalAgentNames = useMemo(
    () => new Map(state.tokens.map((token) => [token.id, token.name])),
    [state.tokens],
  );
  const approvalSessionTokenNames = useMemo(
    () =>
      new Map(
        state.rows.flatMap((row) =>
          row.tokenName === null ? [] : [[row.id, row.tokenName] as const],
        ),
      ),
    [state.rows],
  );
  // The exact session is safer than a token→session guess: one token can own
  // several sessions, and the last one in the list is not the requester. The
  // agent label is the token name (own or disclosed by the board session),
  // then the token id; the session name is a separate field and never the
  // agent attribution.
  const approvalNameFor = useCallback(
    (
      row: Pick<
        AttentionApprovalRow,
        "requestedByTokenId" | "agentSessionId" | "sessionName" | "tokenName"
      >,
    ): string =>
      row.tokenName ??
      approvalAgentNames.get(row.requestedByTokenId) ??
      (row.agentSessionId === null
        ? undefined
        : approvalSessionTokenNames.get(row.agentSessionId)) ??
      shortTokenId(row.requestedByTokenId),
    [approvalAgentNames, approvalSessionTokenNames],
  );
  const selectedApprovalId = params.get("approval");
  const scopedApprovalRows = useMemo<AttentionApprovalRow[]>(() => {
    const query = filter.query.trim().toLowerCase();
    return pending.rows
      .filter((row) => {
        if (filter.board !== "all" && row.boardId !== filter.board)
          return false;
        if (filter.token !== "all" && row.requestedByTokenId !== filter.token) {
          return false;
        }
        if (query === "") return true;
        return [
          row.summary,
          row.actionType,
          row.planHash,
          row.boardTitle,
          row.requestedByTokenId,
          row.cardId,
          row.agentSessionId,
        ]
          .filter((value): value is string => typeof value === "string")
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .map((row) => ({
        ...row,
        agentName: approvalNameFor(row),
      }));
  }, [approvalNameFor, filter.board, filter.query, filter.token, pending.rows]);
  const approvalRowsForFilter = useMemo(
    () =>
      scopedApprovalRows.filter((row) => {
        const pending =
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending";
        if (approvalFilter === "needs") return pending;
        if (approvalFilter === "decided") return !pending;
        return true;
      }),
    [approvalFilter, now, scopedApprovalRows],
  );
  const scopedPendingCount = useMemo(
    () =>
      scopedApprovalRows.filter(
        (row) =>
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
      ).length,
    [now, scopedApprovalRows],
  );
  const defaultApprovalId =
    approvalRowsForFilter.find(
      (row) =>
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
    )?.id ??
    approvalRowsForFilter[0]?.id ??
    null;
  const selectedSession = params.get("session");
  // An explicit `?approval=` link is a deliberate deep link; it wins over the
  // current filter and may point at a decided/expired row. Otherwise the
  // detail auto-follows the first visible pending row — unless the user has
  // explicitly opened a session from the same Attention list, which must win
  // over the default approval selection.
  const visibleApprovalId =
    selectedApprovalId ?? (selectedSession === null ? defaultApprovalId : null);
  const nextPendingApproval = useMemo(() => {
    if (visibleApprovalId === null) return null;
    // Decided is a history filter, not a reason to lose the pending peers:
    // an approved detail opened from Recently decided still offers the next
    // request waiting for a decision.
    const pendingRows = scopedApprovalRows.filter(
      (row) =>
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
    );
    if (pendingRows.length === 0) return null;
    const index = pendingRows.findIndex((row) => row.id === visibleApprovalId);
    // The open row is decided: offer the first pending peer. A pending row
    // only gets a "next" when at least one other request is waiting.
    if (index === -1) return pendingRows[0] ?? null;
    if (pendingRows.length < 2) return null;
    return pendingRows[(index + 1) % pendingRows.length] ?? null;
  }, [now, scopedApprovalRows, visibleApprovalId]);
  const pendingForScope =
    filter.board === "all" ? pendingAll : (pendingCounts[filter.board] ?? null);
  const scopedRows = useMemo(
    () =>
      filter.board === "all"
        ? state.rows
        : state.rows.filter((row) => row.boardId === filter.board),
    [filter.board, state.rows],
  );
  // TASK-179.8: the Attention badge is the pending-decision count, never a
  // mixed approvals+stale total. Stale sessions stay visible in the list but
  // do not inflate this number (the mockup uses `scopePending()`).
  const attentionCount = isAttentionAdmin ? pendingForScope : null;
  const sessionCount = scopedRows.length;

  const selectedRunId = params.get("run");
  const selectedApprovalBase =
    visibleApprovalId === null
      ? undefined
      : pending.rows.find((row) => row.id === visibleApprovalId);
  const approvalBoardId =
    selectedApprovalId !== null
      ? params.get("board")
      : (params.get("board") ?? selectedApprovalBase?.boardId ?? null);
  const selectedRunRow =
    selectedRunId === null
      ? undefined
      : runs.rows.find((run) => run.id === selectedRunId);
  // The desktop master-detail opens the newest run until the URL pins one;
  // mobile keeps the list until a row is tapped.
  const autoRunRow =
    section === "runs" && selectedRunId === null
      ? (runs.rows.find((row) => row.id === autoRunId) ?? runs.rows[0])
      : undefined;
  const runDetailRunId = selectedRunId ?? autoRunRow?.id ?? null;
  const runDetailBoardId =
    selectedRunId !== null
      ? (params.get("board") ?? "all")
      : (autoRunRow?.boardId ?? runFilter.board);
  const runBoardRole =
    roleForRunBoard(state.boards, runDetailBoardId) ??
    selectedRunRow?.boardRole ??
    autoRunRow?.boardRole;
  const runBoardTitle =
    selectedRunRow?.boardTitle ??
    autoRunRow?.boardTitle ??
    state.boards.find((board) => board.id === runDetailBoardId)?.title ??
    runDetailBoardId;
  const runBoard = loadedBoards.find((board) => board.id === runDetailBoardId);
  const runTokenNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const token of state.tokens) names.set(token.id, token.name);
    for (const row of state.rows) {
      if (names.has(row.apiTokenId)) continue;
      names.set(row.apiTokenId, agentLabel(row));
    }
    for (const row of runs.rows) {
      if (row.apiTokenId === null || names.has(row.apiTokenId)) continue;
      names.set(row.apiTokenId, row.tokenName ?? shortTokenId(row.apiTokenId));
    }
    return names;
  }, [runs.rows, state.rows, state.tokens]);
  const runSessionNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of state.rows) {
      names.set(row.id, row.name ?? shortId(row.id));
    }
    for (const row of runs.rows) {
      if (row.agentSessionId === null || names.has(row.agentSessionId))
        continue;
      names.set(
        row.agentSessionId,
        row.sessionName ?? shortId(row.agentSessionId),
      );
    }
    return names;
  }, [runs.rows, state.rows]);
  const approvalBoardTitle =
    selectedApprovalBase?.boardTitle ??
    state.boards.find((board) => board.id === approvalBoardId)?.title ??
    "";
  const filtered = useMemo(
    () => state.rows.filter((row) => matchesAgentFilter(row, filter, now)),
    [state.rows, filter, now],
  );
  const sessionGroups = useMemo(() => {
    const groups = groupSessionRows(filtered, groupMode);
    if (groupMode !== "board") return groups;
    return groups.map((group) => ({
      ...group,
      pending:
        group.boardId === undefined ? 0 : (pendingCounts[group.boardId] ?? 0),
    }));
  }, [filtered, groupMode, pendingCounts]);
  const sessionDetailRow = useMemo(() => {
    if (section !== "sessions" && section !== "attention") return undefined;
    if (selectedSession !== null) {
      return filtered.find((row) => row.id === selectedSession);
    }
    // A board admin without an approval selection keeps the mockup's
    // "Nothing selected" pane. A member has no approval queue, so Attention
    // still previews the first visible session and highlights its row.
    if (section === "attention" && isAttentionAdmin) return undefined;
    return filtered[0];
  }, [filtered, isAttentionAdmin, section, selectedSession]);
  const sessionMissing =
    !state.loading &&
    selectedSession !== null &&
    sessionDetailRow === undefined;
  const sessionSheetOpen =
    (section === "sessions" || section === "attention") &&
    selectedSession !== null;
  const runBoardKnown =
    runDetailBoardId !== "all" &&
    state.boards.some((board) => board.id === runDetailBoardId) &&
    !runs.revokedBoardIds.includes(runDetailBoardId);
  const runSheetOpen =
    section === "runs" && selectedRunId !== null && runBoardKnown;
  const approvalSheetOpen =
    section === "attention" &&
    isAttentionAdmin &&
    selectedApprovalId !== null &&
    approvalBoardId !== null;
  // Below 1061 px the detail panel is an absolute sheet inside the page
  // scroller, so a stale scroll offset would place its header above the
  // viewport. Reset it whenever any sheet opens.
  useEffect(() => {
    if (!(sessionSheetOpen || runSheetOpen || approvalSheetOpen)) return;
    if (!window.matchMedia("(max-width: 1060px)").matches) return;
    if (pageRef.current !== null) pageRef.current.scrollTop = 0;
  }, [sessionSheetOpen, runSheetOpen, approvalSheetOpen]);
  const boardOptions = [
    { value: "all", label: t("agents.filters.allBoards") },
    ...state.boards.map((board) => ({ value: board.id, label: board.title })),
    ...(filter.board !== "all" &&
    !state.boards.some((board) => board.id === filter.board)
      ? [{ value: filter.board, label: t("agents.shell.unknownBoard") }]
      : []),
  ];
  const tokenOptions = [
    { value: "all", label: t("agents.filters.allTokens") },
    ...[
      ...new Map(
        state.rows.map((row) => [row.apiTokenId, agentLabel(row)]),
      ).entries(),
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...(filter.token !== "all" &&
    !state.rows.some((row) => row.apiTokenId === filter.token)
      ? [{ value: filter.token, label: shortTokenId(filter.token) }]
      : []),
  ];
  const statusOptions = AGENT_STATUS_FILTERS.map((value) => ({
    value,
    label:
      value === "all"
        ? t("agents.filters.allStatuses")
        : value === "live"
          ? t("agents.filters.live")
          : value === "stale"
            ? t("agents.filters.stale")
            : t(`agents.status.${value}`),
  }));
  const runOptions = useMemo(() => runFilterOptions(t), [t]);
  const runTokenOptions = useMemo(
    () => [
      { value: "all", label: t("agents.filters.allTokens") },
      ...[...runTokenNames.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(runFilter.token !== "all" && !runTokenNames.has(runFilter.token)
        ? [{ value: runFilter.token, label: shortTokenId(runFilter.token) }]
        : []),
    ],
    [runFilter.token, runTokenNames, t],
  );
  const runSessionOptions = useMemo(
    () => [
      { value: "all", label: t("agents.shell.allSessions") },
      ...[...runSessionNames.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(runFilter.session !== "all" && !runSessionNames.has(runFilter.session)
        ? [{ value: runFilter.session, label: shortId(runFilter.session) }]
        : []),
    ],
    [runFilter.session, runSessionNames, t],
  );
  const noteRunConflicts = useCallback((runId: string, count: number) => {
    setRunConflicts((current) => {
      const next = new Map(current);
      next.set(runId, count);
      return next;
    });
  }, []);
  const filteredActive =
    filter.token !== "all" ||
    filter.status !== "all" ||
    filter.time !== "any" ||
    filter.query.trim() !== "";
  const showAllClear =
    isAttentionAdmin &&
    state.rows.length > 0 &&
    pendingForScope !== null &&
    scopedPendingCount === 0 &&
    approvalFilter === "needs" &&
    !filteredActive &&
    !state.error &&
    !pending.error &&
    !pending.loading;
  const unknownBoard =
    !state.loading &&
    (!state.error || state.errorStatus === 403 || state.errorStatus === 404) &&
    filter.board !== "all" &&
    (!state.boards.some((board) => board.id === filter.board) ||
      (section === "runs" && runs.revokedBoardIds.includes(filter.board)));
  const missingScope =
    !params.has("board") && (params.has("approval") || params.has("run"));
  // A failed approvals request means the Attention timestamp cannot claim
  // freshness, even when the board/session fetch succeeded.
  const freshnessStale =
    state.error ||
    offline ||
    (section === "attention" && pending.error) ||
    (section === "runs" && runs.error);
  // The page-head description must stay on one line at 1440/1024. Full board
  // titles (“Agent Ops Demo · Website Relaunch…”) pushed it to a second line,
  // so the summary uses the mockup's compact labels while the tooltip keeps
  // the full names.
  const freshnessText = freshnessStale
    ? t("agents.shell.freshnessUnknown")
    : state.lastLoadedAt === null
      ? ""
      : state.boards
          .filter(
            (board) => filter.board === "all" || board.id === filter.board,
          )
          .map((board) =>
            state.boardLoadedAt[board.id] === undefined
              ? null
              : `${compactBoardTitle(board.title)} ${t("agents.shell.updatedAge", { seconds: Math.max(0, Math.floor((now - state.boardLoadedAt[board.id]) / 1000)) })}`,
          )
          .filter(Boolean)
          .join(" · ") ||
        t("agents.shell.updated", {
          seconds: Math.max(0, Math.floor((now - state.lastLoadedAt) / 1000)),
        });
  const freshnessFull = state.boards
    .filter((board) => filter.board === "all" || board.id === filter.board)
    .map((board) => board.title)
    .join(" · ");
  // One partial-error banner on Runs, even when both the session fan-out and
  // the run fan-out failed. The board names come from either source and the
  // Retry refreshes both, so the retained rows cannot claim to be fresh.
  const unavailableRunBoardIds = useMemo(() => {
    const ids = new Set<string>(runs.errorBoardIds);
    if (state.error) for (const id of state.staleBoardIds) ids.add(id);
    return [...ids];
  }, [runs.errorBoardIds, state.error, state.staleBoardIds]);
  const unavailableRunBoards = unavailableRunBoardIds
    .map((id) => state.boards.find((board) => board.id === id)?.title ?? id)
    .join(", ");
  // Exactly one banner per failure mode on Runs:
  // - runs failed -> runs banner (names session-only failures too);
  // - only sessions failed -> the generic sessions banner;
  // - both -> the runs banner is the single consolidated one.
  const showRunsPartialError =
    section === "runs" && runs.rows.length > 0 && runs.error;
  const openTokens = () =>
    window.dispatchEvent(new Event("janosik:open-api-keys"));

  if (!isApiEnabled())
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">
          {t("agents.unavailable")}
        </p>
      </main>
    );

  return (
    <main
      ref={pageRef}
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto font-agent-surface text-[13px] leading-[1.45] md:flex-row md:overflow-hidden"
      data-testid="agents-page"
    >
      <aside className="flex shrink-0 flex-col border-b border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] px-[10px] pt-4 pb-3 md:w-[198px] md:border-r md:border-b-0 xl:w-[222px] max-md:px-[9px] max-md:pt-1.5 max-md:pb-1.5">
        <div className="hidden px-1.5 pb-3 md:block">
          <h1 className="font-agent-display text-[17px] font-bold leading-[1.15] tracking-[-0.025em]">
            {t("agents.title")}
          </h1>
          <p className="mt-[3px] max-w-[19ch] text-[11px] leading-[1.45] text-muted-foreground">
            {t("agents.shell.tagline")}
          </p>
        </div>
        <nav
          role="tablist"
          aria-label={t("agents.title")}
          aria-orientation={verticalRail ? "vertical" : "horizontal"}
          className="flex gap-[3px] overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible"
        >
          {SECTIONS.map((item) => {
            const Icon =
              item === "attention"
                ? Inbox
                : item === "sessions"
                  ? Activity
                  : History;
            const count =
              item === "attention"
                ? attentionCount
                : item === "sessions"
                  ? sessionCount
                  : runCount.loading ||
                      runCount.loadingMore ||
                      runCount.hasMore ||
                      runCount.error
                    ? null
                    : runCount.total;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                id={`agents-tab-${item}`}
                aria-controls="agents-panel"
                aria-selected={section === item}
                tabIndex={section === item ? 0 : -1}
                onKeyDown={onSectionKeyDown}
                aria-current={section === item ? "page" : undefined}
                onClick={() => setSection(item)}
                data-testid={`agents-section-${item}`}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[6px] border border-transparent px-2 text-left font-agent-surface text-[12px] font-[550] leading-[1.45] text-muted-foreground hover:bg-hover hover:text-foreground md:min-h-[34px] md:flex-none max-md:min-h-11 max-md:flex-none max-md:gap-2 max-md:rounded-[5px] max-md:text-[11px]",
                  section === item &&
                    "border-border bg-surface text-foreground shadow-[inset_2px_0_0_var(--primary)] hover:bg-surface",
                )}
              >
                <Icon
                  className="h-3.5 w-3.5 shrink-0 max-md:h-3 max-md:w-3"
                  aria-hidden
                />
                {t(`agents.shell.${item}`)}
                {state.loading ? (
                  <span
                    className="ml-auto inline-grid h-[18px] min-w-[18px] place-items-center rounded bg-hover px-1 text-[11px] font-[650] tabular-nums text-muted-foreground"
                    data-state="loading"
                    title={t("common.loading")}
                    aria-hidden
                  >
                    —
                  </span>
                ) : count !== null && count > 0 ? (
                  <span
                    data-testid={`agents-count-${item}`}
                    data-state={
                      item === "attention" && pending.stale
                        ? "stale"
                        : undefined
                    }
                    title={
                      item === "attention"
                        ? pending.stale
                          ? `${t("agents.shell.pendingDecisions", { count })} · ${t("agents.pending.stale")}`
                          : t("agents.shell.pendingDecisions", { count })
                        : undefined
                    }
                    className={cn(
                      "ml-auto inline-grid h-[18px] min-w-[18px] place-items-center rounded px-1 text-[11px] font-[650] tabular-nums",
                      item === "attention"
                        ? "border border-warning/26 bg-warning/12 text-[color:var(--warning)]"
                        : section === item
                          ? "bg-primary/15 text-[color:var(--agent-tone-primary)]"
                          : "bg-hover text-muted-foreground",
                    )}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-[18px] hidden md:block">
          <p className="flex items-center justify-between px-2 pb-[5px] font-agent-surface text-[11px] font-[650] uppercase tracking-[0.07em] text-muted-foreground">
            <span>{t("agents.shell.boards")}</span>
            <span data-testid="agents-boards-scope">
              {hasAdminBoard
                ? t("agents.shell.pending")
                : t("agents.shell.scope")}
            </span>
          </p>
          <div className="max-h-60 overflow-y-auto">
            {boardOptions.map((board) => {
              const count =
                board.value === "all"
                  ? pendingAll
                  : (pendingCounts[board.value] ?? null);
              return (
                <button
                  key={board.value}
                  type="button"
                  onClick={() =>
                    section === "runs"
                      ? setRunFilter({ board: board.value })
                      : setFilter({ board: board.value })
                  }
                  aria-pressed={filter.board === board.value}
                  className={cn(
                    "flex min-h-8 w-full items-center gap-[7px] rounded-[6px] border border-transparent px-2 text-left font-agent-surface text-[11.5px] font-normal leading-[1.45] text-muted-foreground hover:bg-hover hover:text-foreground",
                    filter.board === board.value &&
                      "border-[color:color-mix(in_oklab,var(--border)_72%,transparent)] bg-[color-mix(in_oklab,var(--hover)_64%,transparent)] text-foreground",
                  )}
                  title={board.label}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0",
                      board.value === "all"
                        ? "rounded-full border border-muted-foreground bg-transparent"
                        : cn("rounded-[2px]", boardColor(board.value)),
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{board.label}</span>
                  {state.staleBoardIds.includes(board.value) ? (
                    <span
                      title={t("agents.shell.staleData")}
                      aria-label={t("agents.shell.staleData")}
                      data-testid={`agents-board-stale-${board.value}`}
                    >
                      <AlertTriangle
                        className="h-3 w-3 text-[color:var(--agent-tone-warning)]"
                        aria-hidden
                      />
                    </span>
                  ) : null}
                  {count !== null && count > 0 ? (
                    <span
                      className="inline-grid h-[18px] min-w-[18px] place-items-center rounded bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-1 text-[11px] font-[650] tabular-nums text-[color:var(--warning)]"
                      data-state={pending.stale ? "stale" : "fresh"}
                      title={
                        pending.stale ? t("agents.pending.stale") : undefined
                      }
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-auto hidden border-t border-border px-2 pt-3 text-[11px] leading-[1.5] text-muted-foreground md:block">
          <p>{t("agents.shell.tokenHint")}</p>
          <button
            type="button"
            onClick={openTokens}
            className="mt-2 inline-flex min-h-9 items-center gap-[5px] text-[11px] font-semibold text-foreground hover:underline"
          >
            {t("agents.shell.manageTokens")}
            <ArrowUpRight className="h-[11px] w-[11px]" aria-hidden />
          </button>
        </div>
      </aside>
      <section
        id="agents-panel"
        role="tabpanel"
        aria-labelledby={`agents-tab-${section}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 flex-col px-[14px] pb-6 pt-4 min-[1181px]:px-[18px] min-[1600px]:max-w-[1200px] max-md:px-[10px] max-md:pt-[11px] max-md:pb-[18px]">
          <header className="mb-3 flex items-start justify-between gap-3 max-md:mb-[9px] max-md:flex-wrap">
            <div className="min-w-0 max-md:min-w-[148px] max-md:flex-1 max-md:basis-[148px] md:max-w-[390px]">
              <h2 className="font-agent-display text-[18px] font-bold leading-[1.2] tracking-[-0.025em] max-md:text-[17px]">
                {t(`agents.shell.${section}`)}
              </h2>
              <p className="mt-[3px] text-[11.5px] leading-[1.45] text-muted-foreground max-md:text-[11px]">
                {section === "attention"
                  ? t("agents.shell.tagline")
                  : section === "sessions"
                    ? t("agents.shell.sessionsDescription")
                    : t("agents.shell.runsDescription")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-[7px] max-md:ml-auto max-md:flex-wrap max-md:justify-end">
              <span
                className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex"
                data-testid="agents-updated"
                style={unknownBoard ? { visibility: "hidden" } : undefined}
                data-state={
                  freshnessStale
                    ? "stale"
                    : state.lastLoadedAt === null
                      ? "idle"
                      : "fresh"
                }
                aria-live="polite"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    freshnessStale
                      ? "bg-warning"
                      : state.lastLoadedAt === null
                        ? "bg-muted-foreground"
                        : "bg-success",
                  )}
                />
                <span title={freshnessFull || undefined}>{freshnessText}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  state.reload();
                  pending.reload();
                  runCount.reload();
                  if (section === "runs") runs.reload();
                }}
                disabled={
                  state.refreshing || (section === "runs" && runs.loading)
                }
                data-testid="agents-refresh"
                className="h-7 min-h-0 gap-[6px] rounded-[6px] border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[9px] text-[11px] leading-none font-[650] max-md:h-11 max-md:min-h-11"
              >
                <RefreshCw
                  className={cn(
                    "!h-[13px] !w-[13px]",
                    state.refreshing && "animate-spin",
                  )}
                  aria-hidden
                />
                {state.refreshing
                  ? t("agents.refreshing")
                  : t("agents.refresh")}
              </Button>
              {section === "sessions" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openTokens}
                  data-testid="agents-manage-tokens"
                  className="h-7 min-h-0 rounded-[6px] px-[9px] text-[11px] leading-none font-[650] max-md:h-11 max-md:min-h-11"
                >
                  {t("agents.shell.manageTokens")}
                </Button>
              ) : null}
              {section === "runs" ? (
                <button
                  type="button"
                  onClick={clearRunFilters}
                  data-testid="agents-runs-clear-all"
                  className="inline-flex h-7 min-h-0 items-center rounded-[6px] px-[9px] text-[11px] leading-none font-[650] text-muted-foreground hover:bg-hover hover:text-foreground max-md:h-11 max-md:min-h-11"
                >
                  {t("agents.runs.clearAll")}
                </button>
              ) : null}
            </div>
          </header>
          <div
            className="mb-3 flex flex-wrap items-center gap-1.5"
            data-testid="agents-filters"
          >
            {section !== "runs" ? (
              <>
                <div className="relative min-w-40 flex-1 basis-full md:max-w-[340px] md:basis-0">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2 h-[13px] w-[13px] -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={filter.query}
                    onChange={(event) =>
                      setFilter({ query: event.target.value })
                    }
                    aria-label={t("agents.filters.search")}
                    placeholder={t("agents.filters.searchPlaceholder")}
                    className="min-h-11 rounded-[6px] border-border bg-[color-mix(in_oklab,var(--background)_38%,var(--surface))] py-0 pr-[9px] pl-[27px] text-[11.5px] shadow-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/15 md:h-[30px] md:min-h-[30px]"
                    data-testid="agents-search"
                  />
                </div>
                <SelectField
                  value={filter.token}
                  options={tokenOptions}
                  onChange={(token) => setFilter({ token })}
                  ariaLabel={t("agents.filters.token")}
                  testId="agents-filter-token"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={filter.status}
                  options={statusOptions}
                  onChange={(status) =>
                    setFilter({ status: status as AgentStatusFilter })
                  }
                  ariaLabel={t("agents.filters.status")}
                  testId="agents-filter-status"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <BoardScopeSelect
                  value={filter.board}
                  boards={state.boards.map((board) => ({
                    id: board.id,
                    title: board.title,
                  }))}
                  onChange={(board) => setFilter({ board })}
                  ariaLabel={t("agents.filters.board")}
                  testId="agents-filter-board"
                  variant="filter"
                  className="w-auto min-w-0"
                  counts={pendingCounts}
                  totalCount={pendingAll}
                  stale={pending.stale}
                />
              </>
            ) : (
              <>
                <SelectField
                  value={runFilter.status}
                  options={runOptions.status}
                  onChange={(status) =>
                    setRunFilter({ status: status as RunStatusFilter })
                  }
                  ariaLabel={t("agentControl.runs.filter.status")}
                  testId="agents-run-filter-status"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.kind}
                  options={runOptions.kind}
                  onChange={(kind) =>
                    setRunFilter({ kind: kind as RunKindFilter })
                  }
                  ariaLabel={t("agentControl.runs.filter.kind")}
                  testId="agents-run-filter-kind"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.time}
                  options={runOptions.time}
                  onChange={(time) =>
                    setRunFilter({ time: time as RunTimeFilter })
                  }
                  ariaLabel={t("agentControl.runs.filter.time")}
                  testId="agents-run-filter-time"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.token}
                  options={runTokenOptions}
                  onChange={(token) => setRunFilter({ token })}
                  ariaLabel={t("agentControl.runs.filter.token")}
                  testId="agents-run-filter-token"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.session}
                  options={runSessionOptions}
                  onChange={(session) => setRunFilter({ session })}
                  ariaLabel={t("agentControl.runs.filter.session")}
                  testId="agents-run-filter-session"
                  chevronClassName="h-3 w-3"
                  className={TOOLBAR_SELECT_CLASS}
                />
                {!missingScope ? (
                  <span
                    className="ml-auto text-[11px] text-muted-foreground"
                    data-testid="agents-runs-total"
                    data-shown={visibleRunRows.length}
                    data-total={runs.total}
                    data-has-more={runs.hasMore ? "true" : "false"}
                    data-state={
                      runs.loading ? "loading" : runs.error ? "error" : "ready"
                    }
                  >
                    {runs.loading || runs.error
                      ? "—"
                      : t("agents.runs.shown", {
                          count: visibleRunRows.length,
                        })}
                  </span>
                ) : null}
              </>
            )}
            {section === "runs" ? (
              hasRunFilter(runFilter) ? (
                <button
                  type="button"
                  onClick={clearRunFilters}
                  data-testid="agents-toolbar-clear"
                  className="inline-flex h-7 min-h-0 items-center rounded-[6px] px-[9px] text-[11px] leading-none font-[650] text-muted-foreground hover:bg-hover hover:text-foreground max-md:h-11 max-md:min-h-11"
                >
                  {t("agents.clearFilters")}
                </button>
              ) : null
            ) : filteredActive ? (
              <button
                type="button"
                onClick={clearFilters}
                data-testid="agents-toolbar-clear"
                className="ml-auto inline-flex h-7 min-h-0 items-center rounded-[6px] px-[9px] text-[11px] leading-none font-[650] text-muted-foreground hover:bg-hover hover:text-foreground max-md:h-11 max-md:min-h-11"
              >
                {t("agents.clearFilters")}
              </button>
            ) : null}
          </div>
          {section === "sessions" &&
          (state.loading || state.rows.length > 0) ? (
            <>
              {filtered.length > 0 ? (
                <div
                  data-testid="agents-sessions-heartbeat-note"
                  className="mb-2.5 flex items-start gap-2 rounded-[7px] border border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-primary/6 px-2.5 py-2 text-[11px] leading-[1.45]"
                >
                  <Info
                    className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-primary)]"
                    aria-hidden
                  />
                  <span>
                    <strong className="font-[650] text-foreground">
                      {t("agents.heartbeat.noteTitle")}
                    </strong>{" "}
                    {t("agents.heartbeat.noteBody")}
                  </span>
                </div>
              ) : null}
              <div
                className="my-1 mb-2 flex flex-wrap items-center gap-2"
                data-testid="agents-session-group-toggle"
              >
                <span className="text-[11px] font-[650] tracking-[0.06em] text-muted-foreground uppercase">
                  {t("agents.groups.groupBy")}
                </span>
                <div
                  role="group"
                  aria-label={t("agents.groups.groupBy")}
                  className="inline-flex items-center gap-0.5 rounded-[8px] border border-border bg-[color-mix(in_oklab,var(--card)_70%,transparent)] p-0.5"
                >
                  <button
                    type="button"
                    data-testid="agents-session-group-board"
                    aria-pressed={groupMode === "board"}
                    onClick={() => setGroupMode("board")}
                    className={cn(
                      "inline-flex h-11 items-center gap-1 rounded-[6px] px-[7px] text-[10.5px] font-[600] text-muted-foreground md:h-[25px]",
                      groupMode === "board" &&
                        "bg-[var(--surface)] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--muted-foreground)_20%,transparent)]",
                    )}
                  >
                    <Folder className="h-[11px] w-[11px]" aria-hidden />
                    {t("agents.groups.board")}
                  </button>
                  <button
                    type="button"
                    data-testid="agents-session-group-token"
                    aria-pressed={groupMode === "token"}
                    onClick={() => setGroupMode("token")}
                    className={cn(
                      "inline-flex h-11 items-center gap-1 rounded-[6px] px-[7px] text-[10.5px] font-[600] text-muted-foreground md:h-[25px]",
                      groupMode === "token" &&
                        "bg-[var(--surface)] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--muted-foreground)_20%,transparent)]",
                    )}
                  >
                    <KeyRound className="h-[11px] w-[11px]" aria-hidden />
                    {t("agents.groups.token")}
                  </button>
                </div>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {state.loading
                    ? "—"
                    : t("agents.groups.summary", {
                        count: filtered.length,
                        live: filtered.filter(isLiveSession).length,
                      })}
                </span>
              </div>
            </>
          ) : null}
          {(state.error || offline) &&
            state.rows.length > 0 &&
            !(section === "runs" && runs.error) && (
              <div
                className={cn(
                  "mb-2.5 flex flex-wrap items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45]",
                  state.rows.length === 0
                    ? "border-danger/40 bg-danger/10 text-[color:var(--agent-tone-danger)]"
                    : "border-warning/35 bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] text-foreground",
                )}
                data-testid="agents-error"
                role="alert"
              >
                <AlertTriangle
                  className={cn(
                    "mt-px h-3.5 w-3.5 shrink-0",
                    state.rows.length === 0
                      ? "text-[color:var(--agent-tone-danger)]"
                      : "text-[color:var(--agent-tone-warning)]",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  {offline ? (
                    t("agents.shell.offline")
                  ) : state.rows.length === 0 ? (
                    t("agents.error.title")
                  ) : (
                    <>
                      <strong className="font-[650]">
                        {t("agents.shell.partialErrorTitle")}
                      </strong>{" "}
                      {t("agents.shell.partialError", {
                        boards: state.staleBoardIds
                          .map(
                            (id) =>
                              state.boards.find((board) => board.id === id)
                                ?.title ?? id,
                          )
                          .join(", "),
                      })}
                      {Object.entries(state.boardLoadedAt ?? {})
                        .filter(([id]) =>
                          state.rows.some((row) => row.boardId === id),
                        )
                        .map(
                          ([id, loaded]) =>
                            ` ${t("agents.shell.lastLoadedBoard", { board: state.boards.find((board) => board.id === id)?.title ?? id, seconds: Math.max(0, Math.floor((now - loaded) / 1000)) })}`,
                        )
                        .join("")}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={state.reload}
                  className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-2.5 text-[11px] font-[650] text-foreground hover:bg-hover md:h-7 md:min-h-7"
                  data-testid="agents-retry"
                >
                  <RefreshCw className="h-[13px] w-[13px]" aria-hidden />
                  {t("agents.retry")}
                </button>
              </div>
            )}
          {section === "attention" &&
          pending.error &&
          !(state.error && state.rows.length === 0) ? (
            <div
              className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-[color:var(--agent-tone-warning)]"
              data-testid="agents-approvals-error"
              role="alert"
            >
              <span>{t("agentControl.approvals.loadError")}</span>
              <button
                type="button"
                onClick={pending.reload}
                className="min-h-9 rounded-sm border border-current/40 px-2 font-medium max-md:min-h-11"
              >
                {t("agents.retry")}
              </button>
            </div>
          ) : null}
          {showRunsPartialError ? (
            <div
              className="mb-2.5 flex flex-wrap items-start gap-2 rounded-[7px] border border-warning/35 bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-2.5 py-2 text-[11px] leading-[1.45] text-foreground"
              role="alert"
              data-testid="agents-runs-stale"
            >
              <AlertTriangle
                className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-warning)]"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                {offline ? (
                  t("agents.shell.offline")
                ) : (
                  <>
                    <strong className="font-[650]">
                      {t("agents.shell.partialErrorTitle")}
                    </strong>{" "}
                    {t("agents.runs.partialError", {
                      boards:
                        unavailableRunBoards || t("agents.filters.allBoards"),
                    })}
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  state.reload();
                  runs.reload();
                  runCount.reload();
                }}
                className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-2.5 text-[11px] font-[650] text-foreground hover:bg-hover md:h-7 md:min-h-7"
                data-testid="agents-runs-retry"
              >
                <RefreshCw className="h-[13px] w-[13px]" aria-hidden />
                {t("agents.retry")}
              </button>
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1 md:overflow-y-auto"
            aria-busy={state.refreshing}
          >
            {state.loading ? (
              <SkeletonRegion
                label={t("agents.loading")}
                testId="agents-loading"
                contentClassName="space-y-2"
              >
                <AgentListSkeleton
                  section={section === "attention" ? "attention" : "sessions"}
                />
              </SkeletonRegion>
            ) : unknownBoard ? (
              <EmptyState
                testId="agents-unknown-board"
                title={t("agents.shell.unknownBoard")}
                body={t("agents.shell.unknownBoardBody")}
                action={
                  <Button
                    variant="outline"
                    className={SMALL_OUTLINE_CLASS}
                    onClick={() =>
                      section === "runs"
                        ? setRunFilter({ board: "all" })
                        : setFilter({ board: "all" })
                    }
                  >
                    {t("agents.shell.allBoards")}
                  </Button>
                }
              />
            ) : state.error && state.rows.length === 0 ? (
              <LoadError onRetry={state.reload} />
            ) : missingScope ? (
              <EmptyState
                testId="agents-missing-scope"
                title={t("agents.shell.missingBoard")}
                body={t("agents.shell.missingBoardBody")}
              />
            ) : section === "runs" ? (
              runs.loading ? (
                <SkeletonRegion
                  label={t("agents.loading")}
                  testId="agents-runs-loading"
                  contentClassName="space-y-2"
                >
                  <AgentListSkeleton section="runs" />
                </SkeletonRegion>
              ) : runs.error && runs.rows.length === 0 ? (
                <EmptyState
                  testId="agents-runs-error"
                  icon={<AlertTriangle className="h-[18px] w-[18px]" />}
                  title={t("agents.runs.loadError")}
                  body={t("agents.runs.stale")}
                  action={
                    <Button
                      variant="outline"
                      onClick={runs.reload}
                      className={`${SMALL_OUTLINE_CLASS} max-md:h-11 max-md:min-h-11`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      {t("agents.retry")}
                    </Button>
                  }
                />
              ) : runs.rows.length === 0 ? (
                hasRunFilter(runFilter) ? (
                  <RunFilteredEmpty onClear={clearRunFilters} />
                ) : (
                  <EmptyState
                    testId="agents-runs-empty"
                    icon={<History className="h-[18px] w-[18px]" />}
                    title={t("agents.runs.emptyTitle")}
                    body={t("agents.runs.emptyBody")}
                    action={
                      <>
                        <Button
                          variant="outline"
                          onClick={clearRunFilters}
                          data-testid="agents-runs-empty-clear"
                          className={SMALL_OUTLINE_CLASS}
                        >
                          {t("agents.clearFilters")}
                        </Button>
                        <Button
                          variant="ghost"
                          asChild
                          className={`${SMALL_BUTTON_CLASS} text-muted-foreground hover:text-foreground`}
                        >
                          <a
                            href={agentRollbackDocsUrl(lang)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("agents.runs.howRollback")}
                          </a>
                        </Button>
                      </>
                    }
                  />
                )
              ) : (
                <>
                  <RunList
                    rows={visibleRunRows}
                    selectedId={runDetailRunId}
                    onSelect={openRun}
                    now={now}
                    variant="global"
                    testIdPrefix="agents-run"
                    listTestId="agents-runs-list"
                    boardTitle={(run) =>
                      state.boards.find((board) => board.id === run.boardId)
                        ?.title ?? run.boardId
                    }
                    tokenLabel={(tokenId) =>
                      tokenId === null
                        ? t("agentControl.runs.noToken")
                        : (runTokenNames.get(tokenId) ?? shortTokenId(tokenId))
                    }
                    conflicts={displayedConflicts}
                  />
                  <div className="flex items-center justify-between gap-2 px-2 py-2.5 text-[11px] text-muted-foreground">
                    <span data-testid="agents-runs-footer-total">
                      {t("agents.runs.footerShown", {
                        shown: visibleRunRows.length,
                        total: runs.rows.length,
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="agents-runs-more"
                      disabled={
                        runs.loadingMore ||
                        (visibleRunRows.length >= runs.rows.length &&
                          !runs.hasMore)
                      }
                      onClick={() => {
                        if (visibleRunRows.length < runs.rows.length) {
                          setRunVisibleCount((value) => value + 7);
                        } else {
                          void runs.loadMore().then(() => {
                            setRunVisibleCount((value) => value + 7);
                          });
                        }
                      }}
                      className={`${SMALL_BUTTON_CLASS} max-md:h-11 max-md:min-h-11`}
                    >
                      {runs.loadingMore ? (
                        <RefreshCw
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : null}
                      {t("agentControl.runs.loadMore")}
                    </Button>
                  </div>
                </>
              )
            ) : section === "attention" ? (
              <>
                {state.rows.length === 0 && state.error ? (
                  <LoadError onRetry={state.reload} />
                ) : (
                  <>
                    {!isAttentionAdmin ? (
                      <MemberAttentionBanner
                        allBoards={filter.board === "all"}
                      />
                    ) : (
                      <>
                        {showAllClear ? (
                          <AllClear
                            onViewSessions={() => setSection("sessions")}
                          />
                        ) : (
                          <AttentionApprovalList
                            loading={pending.loading}
                            rows={scopedApprovalRows}
                            filter={approvalFilter}
                            onFilterChange={changeApprovalFilter}
                            selectedId={visibleApprovalId}
                            onSelect={openApproval}
                            onReject={(row) => openApproval(row, "reject")}
                            now={now}
                          />
                        )}
                      </>
                    )}
                    {state.rows.length === 0 && !filteredActive ? (
                      <AttentionEmpty onOpenTokens={openTokens} lang={lang} />
                    ) : filtered.length === 0 ? (
                      filteredActive && scopedApprovalRows.length === 0 ? (
                        <FilteredEmpty onClear={clearFilters} approvals />
                      ) : null
                    ) : (
                      <>
                        <AttentionStaleSessions
                          rows={filtered}
                          now={now}
                          selectedId={sessionDetailRow?.id ?? null}
                          onSelect={openSession}
                        />
                        <AttentionLiveSessions
                          rows={filtered}
                          now={now}
                          selectedId={sessionDetailRow?.id ?? null}
                          onSelect={openSession}
                          onViewAll={() => setSection("sessions")}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {state.rows.length === 0 && state.error ? (
                  <LoadError onRetry={state.reload} />
                ) : state.rows.length === 0 ? (
                  <SessionsEmpty onOpenTokens={openTokens} lang={lang} />
                ) : sessionGroups.length === 0 ? (
                  <FilteredEmpty onClear={clearFilters} />
                ) : (
                  <SessionGroupList
                    groups={sessionGroups}
                    mode={groupMode}
                    selectedId={sessionDetailRow?.id ?? null}
                    now={now}
                    staleBoardIds={state.staleBoardIds}
                    boardLoadedAt={state.boardLoadedAt}
                    onSelect={openSession}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </section>
      {approvalSheetOpen ? (
        <button
          type="button"
          aria-label={t("agents.approvals.back")}
          data-testid="agents-approval-sheet-scrim"
          onClick={closeApproval}
          className="absolute inset-0 z-40 bg-black/28 min-[1061px]:hidden"
        />
      ) : null}
      {sessionSheetOpen ? (
        <button
          type="button"
          aria-label={t("agents.detail.back")}
          data-testid="agents-session-sheet-scrim"
          onClick={closeSession}
          className="absolute inset-0 z-40 bg-black/28 min-[1061px]:hidden"
        />
      ) : null}
      {runSheetOpen ? (
        <button
          type="button"
          aria-label={t("agents.runs.backToList")}
          data-testid="agents-run-sheet-scrim"
          onClick={closeRun}
          className="absolute inset-0 z-40 bg-black/28 min-[1061px]:hidden"
        />
      ) : null}
      <aside
        data-testid="agents-detail-panel"
        className={cn(
          "hidden shrink-0 flex-col border-l border-border bg-[color-mix(in_oklab,var(--surface)_48%,var(--background))] min-[1061px]:flex min-[1061px]:w-[324px] min-[1181px]:w-[352px] min-[1600px]:w-[400px]",
          (missingScope || unknownBoard) && "!hidden",
          ((section === "attention" &&
            isAttentionAdmin &&
            selectedApprovalId !== null &&
            approvalBoardId !== null) ||
            sessionSheetOpen ||
            runSheetOpen) &&
            "max-[1060px]:absolute max-[1060px]:inset-y-0 max-[1060px]:right-0 max-[1060px]:z-50 max-[1060px]:flex max-[1060px]:w-[min(372px,100%)] max-[1060px]:border-l max-[1060px]:border-border max-[1060px]:bg-background max-[1060px]:pb-[env(safe-area-inset-bottom)] max-[1060px]:shadow-[-24px_0_60px_-36px_rgb(0_0_0/0.7)] max-[760px]:w-full",
        )}
        aria-label={t("agents.shell.details")}
      >
        {missingScope || unknownBoard ? (
          <GenericDetailEmpty />
        ) : state.loading ? (
          <div className="p-4" data-testid="agents-detail-loading">
            <Skeleton variant="text" lines={3} />
          </div>
        ) : state.error && state.rows.length === 0 ? (
          <GenericDetailEmpty />
        ) : section === "sessions" &&
          filteredActive &&
          filtered.length === 0 ? (
          <GenericDetailEmpty />
        ) : section === "runs" ? (
          runDetailRunId !== null && runBoardKnown ? (
            <RunDetail
              boardId={runDetailBoardId}
              runId={runDetailRunId}
              role={runBoardRole}
              boardTitle={runBoardTitle}
              board={runBoard}
              variant="global"
              tokenLabel={(tokenId) =>
                tokenId === null
                  ? t("agentControl.runs.noToken")
                  : (runTokenNames.get(tokenId) ?? shortTokenId(tokenId))
              }
              sessionLabel={(sessionId) =>
                sessionId === null
                  ? t("agentControl.runs.noSession")
                  : (runSessionNames.get(sessionId) ?? shortId(sessionId))
              }
              onClose={closeRun}
              onChanged={() => {
                runs.reload();
                runCount.reload();
              }}
              onPreview={noteRunConflicts}
              onOpenSession={openRunSession}
            />
          ) : state.rows.length === 0 ? (
            <SessionDetail
              row={undefined}
              missingId={null}
              now={now}
              isAgentToken={state.isAgentToken}
              staleBoardIds={state.staleBoardIds}
              onClose={closeSession}
              onSaved={state.replaceSession}
              onOpenTokens={openTokens}
            />
          ) : (
            <GenericDetailEmpty />
          )
        ) : section === "attention" &&
          isAttentionAdmin &&
          visibleApprovalId !== null &&
          approvalBoardId !== null ? (
          <AttentionApprovalDetail
            boardId={approvalBoardId}
            approvalId={visibleApprovalId}
            boardTitle={approvalBoardTitle}
            fallbackAgentName={
              selectedApprovalBase === undefined
                ? undefined
                : approvalNameFor(selectedApprovalBase)
            }
            fallbackCardTitle={selectedApprovalBase?.cardTitle ?? undefined}
            initialMode={approvalIntent}
            onChanged={pending.reload}
            onBack={closeApproval}
            onNextPending={
              nextPendingApproval === null
                ? undefined
                : () => {
                    // Decided is a history view; moving to a pending peer must
                    // also move the list back to Needs so the selected detail
                    // is visibly in the queue.
                    setApprovalFilter("needs");
                    openApproval(nextPendingApproval);
                  }
            }
          />
        ) : section === "sessions" ||
          (section === "attention" && sessionDetailRow !== undefined) ? (
          <SessionDetail
            row={sessionDetailRow}
            missingId={sessionMissing ? selectedSession : null}
            now={now}
            isAgentToken={state.isAgentToken}
            staleBoardIds={state.staleBoardIds}
            onClose={closeSession}
            onSaved={state.replaceSession}
            onOpenTokens={openTokens}
          />
        ) : state.rows.length === 0 ? (
          <SessionDetail
            row={undefined}
            missingId={null}
            now={now}
            isAgentToken={state.isAgentToken}
            staleBoardIds={state.staleBoardIds}
            onClose={closeSession}
            onSaved={state.replaceSession}
            onOpenTokens={openTokens}
          />
        ) : (
          <GenericDetailEmpty />
        )}
      </aside>
    </main>
  );
}

type CountChipTone = "ok" | "warn" | "muted";

const COUNT_CHIP_TONE: Record<CountChipTone, string> = {
  ok: "border-[color-mix(in_oklab,var(--success)_34%,var(--border))] bg-success/7 text-[color:var(--success)]",
  warn: "border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-warning/7 text-[color:var(--agent-tone-warning)]",
  muted:
    "border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] text-muted-foreground",
};

/** Prototype `.chip`: 20 px high, 4 px radius; the app keeps the 11 px floor. */
function CountChip({
  tone,
  dot = false,
  testId,
  children,
}: {
  tone: CountChipTone;
  dot?: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex h-[21px] items-center gap-1 rounded-[4px] border px-1.5 text-[11px] leading-none font-semibold whitespace-nowrap",
        COUNT_CHIP_TONE[tone],
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className="h-[5px] w-[5px] shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * TASK-179.3 — the prototype's stale block is two session cards, not an
 * agent roll-up: each card selects that exact session in the right panel.
 */
function AttentionStaleSessions({
  rows,
  now,
  selectedId,
  onSelect,
}: {
  rows: AgentSessionRow[];
  now: number;
  selectedId: string | null;
  onSelect: (row: AgentSessionRow) => void;
}) {
  const { t } = useI18n();
  // A human pause explains the missing heartbeat: paused sessions stay in
  // the live preview instead of competing for the two "Needs a nudge" cards.
  const stale = rows.filter(needsNudge).slice(0, 2);
  if (stale.length === 0) return null;
  return (
    <section
      aria-labelledby="agents-stale-heading"
      data-testid="agents-stale-sessions"
      className="mt-[18px]"
    >
      <div className="mb-[7px] flex flex-wrap items-center gap-2">
        <h3
          id="agents-stale-heading"
          className="m-0 text-[12px] font-[650] leading-[1.45]"
        >
          {t("agents.shell.needsNudge")}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {t("agents.shell.heartbeatHint")}
        </span>
      </div>
      <div className="flex flex-col gap-[7px]">
        {stale.map((row) => (
          <button
            key={row.id}
            type="button"
            aria-pressed={selectedId === row.id}
            aria-label={t("agents.shell.staleCardLabel", {
              agent: agentLabel(row),
              session: row.name ?? shortId(row.id),
            })}
            data-testid={`agents-stale-session-${row.id}`}
            onClick={() => onSelect(row)}
            className={cn(
              "mt-2 flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-[10px] text-left transition-colors",
              selectedId === row.id
                ? "border-[color-mix(in_oklab,var(--warning)_54%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_8%,var(--surface))]"
                : "border-[color-mix(in_oklab,var(--warning)_26%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))] hover:bg-[color-mix(in_oklab,var(--warning)_7%,var(--surface))]",
            )}
          >
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border border-[color-mix(in_oklab,var(--warning)_26%,var(--border))] bg-warning/10 text-[color:var(--warning)]">
              <Clock className="h-[15px] w-[15px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[11.5px] leading-[1.35] font-[650] break-words">
                {agentLabel(row)} · {row.name ?? shortId(row.id)}
              </b>
              <span className="mt-px flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] leading-[1.4] text-muted-foreground">
                <span className="truncate">{row.boardTitle}</span>
                <span aria-hidden>·</span>
                <HeartbeatText session={row} now={now} withIcon={false} muted />
                <span aria-hidden>·</span>
                <span className="truncate">
                  {t("agents.shell.lastStatus", {
                    status: t(`agents.status.${row.status}`),
                  })}
                </span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-[3px] text-[11px] font-semibold text-foreground">
              {t("agents.shell.inspect")}
              <ChevronRight className="h-[11px] w-[11px]" aria-hidden />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * TASK-179.3 — the mockup keeps a compact live preview below the stale block,
 * so an approval can be waiting while a session is still visible. `row.stale`
 * wins: a stale row stays in "Needs a nudge" and never repeats here.
 */
function AttentionLiveSessions({
  rows,
  now,
  selectedId,
  onSelect,
  onViewAll,
}: {
  rows: AgentSessionRow[];
  now: number;
  selectedId: string | null;
  onSelect: (row: AgentSessionRow) => void;
  onViewAll: () => void;
}) {
  const { t } = useI18n();
  // A paused session belongs here even when its heartbeat aged out: silence
  // is expected while paused, and hiding it made the row disappear after a
  // pause. Genuinely stale, unpaused rows stay in "Needs a nudge".
  const live = rows.filter(
    (row) => isLiveSession(row) && (!row.stale || isSessionPaused(row)),
  );
  if (live.length === 0) return null;
  // Counts mirror the prototype: they describe every filtered session, not
  // just the four rows in the preview.
  const active = rows.filter(
    (row) => row.status === "active" && !row.paused,
  ).length;
  const waiting = rows.filter(
    (row) => row.status === "waiting_approval" && !row.paused,
  ).length;
  // The chip is a factual heartbeat count (same as the Sessions group header
  // and the mockup); `needsNudge` only decides which rows get warning cards.
  const stale = rows.filter((row) => row.stale).length;
  const paused = rows.filter((row) => row.paused).length;

  return (
    <section
      aria-labelledby="agents-live-heading"
      data-testid="agents-live-sessions"
      className="mt-[18px]"
    >
      <div className="mb-[7px] flex flex-wrap items-center gap-2">
        <h3
          id="agents-live-heading"
          className="m-0 text-[12px] font-[650] leading-[1.45]"
        >
          {t("agents.shell.liveSessions")}
        </h3>
        <span
          className="flex flex-wrap items-center gap-1"
          data-testid="agents-live-counts"
        >
          <CountChip tone="ok" dot testId="agents-live-count-active">
            {t("agents.shell.activeCount", { count: active })}
          </CountChip>
          {waiting > 0 ? (
            <CountChip tone="warn" testId="agents-live-count-waiting">
              {t("agents.waitingCount", { count: waiting })}
            </CountChip>
          ) : null}
          {stale > 0 ? (
            <CountChip tone="warn" dot testId="agents-live-count-stale">
              {t("agents.groups.noHeartbeat", { count: stale })}
            </CountChip>
          ) : null}
          {paused > 0 ? (
            <CountChip tone="muted" testId="agents-live-count-paused">
              {t("agents.shell.pausedCount", { count: paused })}
            </CountChip>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onViewAll}
          data-testid="agents-live-view-all"
          className="ml-auto inline-flex min-h-11 items-center gap-[3px] text-[11px] text-muted-foreground hover:text-foreground min-[761px]:min-h-0"
        >
          {t("agents.shell.viewAll")}
          <ChevronRight className="h-[11px] w-[11px]" aria-hidden />
        </button>
      </div>
      <div
        className="min-w-0 overflow-x-auto"
        data-testid="agents-live-session-table"
      >
        <SessionTableHeader />
        <div className="border-t border-border">
          {live.slice(0, 4).map((row) => (
            <SessionRow
              key={row.id}
              row={row}
              mode="board"
              selected={selectedId === row.id}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A display-only compact board label for the page-head freshness summary:
 * “Agent Ops Demo” → “Agent Ops”, “Website Relaunch” → “Website”. The full
 * title stays available as the summary tooltip. Boards whose first word is
 * already too long keep an ellipsis instead of vanishing.
 */
function compactBoardTitle(title: string, max = 12): string {
  const trimmed = title.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max + 1);
  const boundary = head.lastIndexOf(" ");
  if (boundary > 0) return head.slice(0, boundary).trimEnd();
  return `${trimmed.slice(0, max)}…`;
}

function MemberAttentionBanner({ allBoards }: { allBoards: boolean }) {
  const { t } = useI18n();
  return (
    <div
      className="mt-0.5 flex items-start gap-2.5 rounded-lg border border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-primary/5 px-3 py-2.5"
      data-testid="agents-member-note"
      role="status"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-[color:var(--agent-tone-primary)]">
        <Info className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <p className="min-w-0 pt-0.5 text-[11.5px] leading-[1.55] text-muted-foreground">
        <span className="font-semibold text-foreground">
          {t(
            allBoards
              ? "agents.shell.memberNoteTitleAll"
              : "agents.shell.memberNoteTitleBoard",
          )}
        </span>{" "}
        {t("agents.shell.memberNoteBody")}
      </p>
    </div>
  );
}

function AllClear({ onViewSessions }: { onViewSessions: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="mt-0.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-[color:color-mix(in_oklab,var(--success)_28%,var(--border))] bg-success/5 px-[11px] py-[9px]"
      data-testid="agents-attention-clear"
    >
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-success/25 bg-success/10 text-[color:var(--agent-tone-success)]">
        <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-[650]">{t("agents.shell.allClear")}</p>
        <p className="text-[11px] leading-[1.45] text-muted-foreground">
          {t("agents.shell.allClearBody")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onViewSessions}
        className={`${SMALL_BUTTON_CLASS} px-[9px]`}
      >
        {t("agents.shell.viewSessions")}
        <ChevronRight className="h-[13px] w-[13px]" aria-hidden />
      </Button>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-load-error"
      icon={<Bot className="h-[18px] w-[18px]" />}
      title={t("agents.error.title")}
      body={t("agents.error.stale")}
      action={
        <Button
          variant="outline"
          onClick={onRetry}
          data-testid="agents-load-error-retry"
          className={`${SMALL_OUTLINE_CLASS} max-md:h-11 max-md:min-h-11`}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("agents.retry")}
        </Button>
      }
    />
  );
}

function RunFilteredEmpty({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-runs-filtered-empty"
      icon={<Search className="h-[18px] w-[18px]" />}
      title={t("agents.runs.noMatch")}
      body={t("agents.runs.noMatchBody")}
      action={
        <Button
          variant="outline"
          onClick={onClear}
          data-testid="agents-runs-clear-filters"
          className={SMALL_OUTLINE_CLASS}
        >
          {t("agents.clearFilters")}
        </Button>
      }
    />
  );
}

/**
 * The mockup's loading shapes: approval cards on Attention, session/run rows
 * elsewhere. The rail reserves a dash instead of popping a fake 0 count.
 */
function AgentListSkeleton({
  section,
}: {
  section: "attention" | "sessions" | "runs";
}) {
  if (section === "attention") {
    return (
      <div className="space-y-2" aria-hidden>
        <div className="mb-1 flex items-center justify-between gap-3">
          <Skeleton width={170} height={12} />
          <Skeleton width={96} height={11} />
        </div>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="rounded-[8px] border border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] px-3 pt-[11px] pb-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Skeleton width={112} height={10} />
              <Skeleton width={64} height={10} />
              <Skeleton width={72} height={10} />
            </div>
            <Skeleton className="mt-2" width="72%" height={13} />
            <Skeleton className="mt-1.5" width="92%" height={10} />
            <div className="mt-2 flex items-center gap-1.5">
              <Skeleton width={62} height={20} className="rounded-[5px]" />
              <Skeleton width={82} height={20} className="rounded-[5px]" />
            </div>
          </div>
        ))}
        <div className="space-y-1.5 pt-2">
          <Skeleton width="52%" height={10} />
          <Skeleton width="68%" height={10} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1" aria-hidden>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 border-b border-border px-4 py-3"
        >
          <Skeleton width={26} height={26} className="rounded-[6px]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton width="55%" height={11} />
            <Skeleton width="78%" height={10} />
          </div>
          <Skeleton width={68} height={22} className="rounded-[5px]" />
        </div>
      ))}
    </div>
  );
}

function FilteredEmpty({
  onClear,
  approvals = false,
}: {
  onClear: () => void;
  approvals?: boolean;
}) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-filtered-empty"
      icon={<Search className="h-[18px] w-[18px]" />}
      title={t(
        approvals ? "agents.approvals.emptyFiltered" : "agents.emptyFiltered",
      )}
      body={t(
        approvals
          ? "agents.approvals.emptyFilteredBody"
          : "agents.emptyFilteredBody",
      )}
      action={
        <Button
          variant="outline"
          onClick={onClear}
          data-testid="agents-clear-filters"
          className={SMALL_OUTLINE_CLASS}
        >
          {t("agents.clearFilters")}
        </Button>
      }
    />
  );
}

function AttentionEmpty({
  onOpenTokens,
  lang,
}: {
  onOpenTokens: () => void;
  lang: string;
}) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-attention-empty"
      icon={<Inbox className="h-[18px] w-[18px]" />}
      title={t("agents.empty.title")}
      body={t("agents.empty.attentionBody")}
      action={
        <>
          <Button onClick={onOpenTokens} className={SMALL_PRIMARY_CLASS}>
            {t("agents.shell.createKey")}
          </Button>
          <Button variant="outline" asChild className={SMALL_OUTLINE_CLASS}>
            <a href={docsUrl(lang)} target="_blank" rel="noreferrer">
              {t("agents.shell.readDocs")}
            </a>
          </Button>
        </>
      }
    />
  );
}

function SessionsEmpty({
  onOpenTokens,
  lang,
}: {
  onOpenTokens: () => void;
  lang: string;
}) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-empty"
      icon={<KeyRound className="h-[18px] w-[18px]" />}
      title={t("agents.empty.title")}
      body={t("agents.empty.body")}
      action={
        <>
          <Button onClick={onOpenTokens} className={SMALL_PRIMARY_CLASS}>
            {t("agents.shell.createKey")}
          </Button>
          <Button variant="outline" asChild className={SMALL_OUTLINE_CLASS}>
            <a href={docsUrl(lang)} target="_blank" rel="noreferrer">
              {t("agents.shell.readDocs")}
            </a>
          </Button>
        </>
      }
    />
  );
}

function GenericDetailEmpty() {
  const { t } = useI18n();
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2">
        <div className="min-w-0">
          <p className="m-0 mb-[3px] text-[11px] font-[650] tracking-[0.07em] text-muted-foreground uppercase">
            {t("agents.shell.detailEyebrow")}
          </p>
          <h2 className="m-0 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em]">
            {t("agents.shell.nothingSelected")}
          </h2>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-7 text-center">
        <span className="mb-0.5 grid h-[34px] w-[34px] place-items-center rounded-lg border border-border bg-surface text-muted-foreground">
          <Inbox className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="m-0 text-[12px] leading-[1.45] font-[650] text-foreground">
          {t("agents.shell.selectItem")}
        </p>
        <p className="m-0 max-w-[30ch] text-[11px] leading-[1.5] text-muted-foreground">
          {t("agents.shell.selectItemBody")}
        </p>
      </div>
    </>
  );
}

function EmptyState({
  testId,
  title,
  body,
  action,
  icon,
}: {
  testId: string;
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-[240px] flex-col items-center justify-center gap-2.5 px-6 py-8 text-center"
      data-testid={testId}
    >
      <span className="mb-0.5 grid h-[38px] w-[38px] place-items-center rounded-[9px] border border-border bg-surface text-muted-foreground">
        {icon ?? <Bot className="h-[18px] w-[18px]" aria-hidden />}
      </span>
      <p className="text-[13px] leading-[1.45] font-[650] text-foreground">
        {title}
      </p>
      <p className="max-w-[42ch] text-[11.5px] leading-[1.55] text-muted-foreground">
        {body}
      </p>
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-[7px]">
          {action}
        </div>
      ) : null}
    </div>
  );
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  empty: string,
): void {
  if (value === empty) params.delete(key);
  else params.set(key, value);
}
