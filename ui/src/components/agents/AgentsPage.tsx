import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChevronRight,
  Folder,
  History,
  Inbox,
  Info,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { BoardSummary } from "@janosik/shared";

import { isApiEnabled } from "@/api/client";
import {
  AgentLastSeen,
  AgentLiveDot,
  AgentStatusBadge,
  AgentStaleBadge,
  AgentPauseBadge,
} from "./agents-ui";
import {
  AGENT_STATUS_FILTERS,
  agentLabel,
  groupAgents,
  isLiveSession,
  latestLiveSession,
  matchesAgentFilter,
  readAgentFilter,
  readAgentGroup,
  shortId,
  type AgentFilter,
  type AgentGroup,
  type AgentSessionRow,
  type AgentStatusFilter,
} from "./agent-model";
import {
  SessionDetail,
  SessionGroupList,
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
import {
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
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import { cn } from "@/lib/utils";
import { boardColor } from "@/utils/board-color";
import { docsUrl } from "@/utils/docs-url";
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
  const [params, setParams] = useSearchParams();
  const state = useAgentSessions();
  const { boards: loadedBoards } = useBoard();
  const filter = useMemo(() => readAgentFilter(params), [params]);
  const runFilter = useMemo(() => readRunFilter(params), [params]);
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
          if ("token" in patch) {
            setOrDelete(search, "token", next.token, "all");
            search.delete("agent");
            search.delete("session");
          }
          setOrDelete(search, "status", next.status, "all");
          setOrDelete(search, "time", next.time, "any");
          setOrDelete(search, "q", next.query, "");
          // A filter change can hide the selected row; closing the detail
          // avoids an orphaned master-detail pane.
          search.delete("session");
          if ("board" in patch) {
            search.delete("approval");
            search.delete("run");
          }
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
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("section", "sessions");
          next.set("session", row.id);
          next.delete("approval");
          next.delete("run");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const closeSession = useCallback(() => {
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
      // stay in the URL: `?agent=` is the old name of the token filter.
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

  const pending = usePendingApprovals({
    boardId: filter.board === "all" ? null : filter.board,
    boards: state.boards,
    enabled: !state.isAgentToken,
  });
  const runs = useAgentRuns(state.boards, {
    enabled: section === "runs",
    filter: runFilter,
  });
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
  const approvalAgentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const token of state.tokens) names.set(token.id, token.name);
    for (const row of state.rows) names.set(row.apiTokenId, agentLabel(row));
    return names;
  }, [state.rows, state.tokens]);
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
        agentName: approvalAgentNames.get(row.requestedByTokenId),
      }));
  }, [
    approvalAgentNames,
    filter.board,
    filter.query,
    filter.token,
    pending.rows,
  ]);
  const scopedPendingCount = useMemo(
    () =>
      scopedApprovalRows.filter(
        (row) =>
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
      ).length,
    [now, scopedApprovalRows],
  );
  const pendingAll = pending.totalCount;
  const pendingForScope =
    filter.board === "all"
      ? pendingAll
      : (pending.counts[filter.board] ?? null);
  const scopedRows = useMemo(
    () =>
      filter.board === "all"
        ? state.rows
        : state.rows.filter((row) => row.boardId === filter.board),
    [filter.board, state.rows],
  );
  const staleCount = scopedRows.filter((row) => row.stale).length;
  const hasAdminBoard = state.boards.some((board) => board.role === "ADMIN");
  const isAttentionAdmin =
    filter.board === "all"
      ? hasAdminBoard
      : state.boards.find((board) => board.id === filter.board)?.role ===
        "ADMIN";
  const attentionCount = isAttentionAdmin
    ? pendingForScope === null
      ? null
      : pendingForScope + staleCount
    : staleCount;
  const sessionCount = scopedRows.length;

  const selectedSession = params.get("session");
  const selectedApprovalId = params.get("approval");
  const selectedRunId = params.get("run");
  const approvalBoardId = params.get("board");
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
      ? runFilter.board
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
      names.set(row.apiTokenId, shortId(row.apiTokenId));
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
      names.set(row.agentSessionId, shortId(row.agentSessionId));
    }
    return names;
  }, [runs.rows, state.rows]);
  const selectedApprovalBase =
    selectedApprovalId === null
      ? undefined
      : pending.rows.find((row) => row.id === selectedApprovalId);
  const approvalBoardTitle =
    selectedApprovalBase?.boardTitle ??
    state.boards.find((board) => board.id === approvalBoardId)?.title ??
    "";
  const filtered = useMemo(
    () => state.rows.filter((row) => matchesAgentFilter(row, filter, now)),
    [state.rows, filter, now],
  );
  const displayed =
    section === "attention" ? filtered.filter((row) => row.stale) : filtered;
  const groups = useMemo(() => groupAgents(displayed), [displayed]);
  const boardGroups = useMemo(() => {
    const buckets = new Map<string, typeof displayed>();
    for (const row of displayed) {
      const bucket = buckets.get(row.boardId) ?? [];
      bucket.push(row);
      buckets.set(row.boardId, bucket);
    }
    return [...buckets.entries()].map(([id, rows]) => ({
      id,
      title: rows[0]?.boardTitle ?? id,
      groups: groupAgents(rows),
    }));
  }, [displayed]);
  const sessionGroups = useMemo(() => {
    const groups = groupSessionRows(displayed, groupMode);
    if (groupMode !== "board") return groups;
    return groups.map((group) => ({
      ...group,
      pending:
        group.boardId === undefined ? 0 : (pending.counts[group.boardId] ?? 0),
    }));
  }, [displayed, groupMode, pending.counts]);
  const sessionDetailRow = useMemo(() => {
    if (section !== "sessions") return undefined;
    if (selectedSession !== null) {
      return displayed.find((row) => row.id === selectedSession);
    }
    return displayed[0];
  }, [displayed, section, selectedSession]);
  const sessionMissing =
    selectedSession !== null && sessionDetailRow === undefined;
  const sessionSheetOpen = section === "sessions" && selectedSession !== null;
  const runBoardKnown =
    runDetailBoardId !== "all" &&
    state.boards.some((board) => board.id === runDetailBoardId) &&
    !runs.revokedBoardIds.includes(runDetailBoardId);
  const runSheetOpen =
    section === "runs" && selectedRunId !== null && runBoardKnown;
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
      ? [{ value: filter.token, label: shortId(filter.token) }]
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
        ? [{ value: runFilter.token, label: shortId(runFilter.token) }]
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
    filter.board === "all" && (params.has("approval") || params.has("run"));
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
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto font-agent-surface md:flex-row md:overflow-hidden"
      data-testid="agents-page"
    >
      <aside className="flex shrink-0 flex-col border-b border-border bg-[color-mix(in_oklab,var(--surface)_58%,var(--background))] px-[10px] pt-4 pb-3 md:w-[208px] md:border-r md:border-b-0 xl:w-[222px] max-md:px-[9px] max-md:pt-1.5 max-md:pb-1.5">
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
                  : runs.rows.length;
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
                {count !== null && count > 0 ? (
                  <span
                    data-testid={`agents-count-${item}`}
                    data-state={
                      item === "attention" && pending.stale
                        ? "stale"
                        : undefined
                    }
                    title={
                      item === "attention" && pending.stale
                        ? t("agents.pending.stale")
                        : undefined
                    }
                    className={cn(
                      "ml-auto inline-grid h-[17px] min-w-[18px] place-items-center rounded px-1 text-[11px] font-semibold tabular-nums",
                      item === "attention"
                        ? "border border-warning/30 bg-warning/10 text-[color:var(--agent-tone-warning)]"
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
            <span>
              {isAttentionAdmin
                ? t("agents.shell.pending")
                : t("agents.shell.scope")}
            </span>
          </p>
          <div className="max-h-60 overflow-y-auto">
            {boardOptions.map((board) => {
              const count =
                board.value === "all"
                  ? pendingAll
                  : (pending.counts[board.value] ?? null);
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
                  {count !== null && count > 0 ? (
                    <span
                      className="inline-grid h-4 min-w-4 place-items-center rounded bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-1 text-[11px] font-[650] tabular-nums text-[color:var(--agent-tone-warning)]"
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
        <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 flex-col px-[14px] pb-6 pt-4 min-[1181px]:px-[18px] max-md:px-[10px] max-md:pt-[11px] max-md:pb-[18px]">
          <header className="mb-3 flex items-start justify-between gap-3 max-md:mb-[9px]">
            <div className="min-w-0">
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
            <div className="flex shrink-0 items-center gap-[7px]">
              <span
                className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex"
                data-testid="agents-updated"
                data-state={
                  state.error || offline
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
                    state.error || offline
                      ? "bg-warning"
                      : state.lastLoadedAt === null
                        ? "bg-muted-foreground"
                        : "bg-success",
                  )}
                />
                <span>
                  {state.error || offline
                    ? t("agents.shell.freshnessUnknown")
                    : state.lastLoadedAt === null
                      ? ""
                      : t("agents.shell.updated", {
                          seconds: Math.max(
                            0,
                            Math.floor((now - state.lastLoadedAt) / 1000),
                          ),
                        })}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  state.reload();
                  pending.reload();
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
                  chevronClassName="h-[11px] w-[11px]"
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
                  chevronClassName="h-[11px] w-[11px]"
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
                  counts={pending.counts}
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
                  chevronClassName="h-[11px] w-[11px]"
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
                  chevronClassName="h-[11px] w-[11px]"
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
                  chevronClassName="h-[11px] w-[11px]"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.token}
                  options={runTokenOptions}
                  onChange={(token) => setRunFilter({ token })}
                  ariaLabel={t("agentControl.runs.filter.token")}
                  testId="agents-run-filter-token"
                  chevronClassName="h-[11px] w-[11px]"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <SelectField
                  value={runFilter.session}
                  options={runSessionOptions}
                  onChange={(session) => setRunFilter({ session })}
                  ariaLabel={t("agentControl.runs.filter.session")}
                  testId="agents-run-filter-session"
                  chevronClassName="h-[11px] w-[11px]"
                  className={TOOLBAR_SELECT_CLASS}
                />
                <span
                  className="ml-auto text-[11px] text-muted-foreground"
                  data-testid="agents-runs-total"
                  data-total={runs.total}
                  data-has-more={runs.hasMore ? "true" : "false"}
                >
                  {runs.hasMore
                    ? t("agents.runs.totalMore", { count: runs.total })
                    : t("agents.runs.shown", { count: runs.total })}
                </span>
              </>
            )}
          </div>
          {section === "sessions" &&
          (state.loading || state.rows.length > 0) ? (
            <>
              {displayed.length > 0 ? (
                <div
                  data-testid="agents-sessions-heartbeat-note"
                  className="mb-2.5 flex items-start gap-2 rounded-[7px] border border-primary/30 bg-primary/6 px-2.5 py-2 text-[11px] leading-[1.45]"
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
                  className="inline-flex items-center rounded-md border border-border bg-surface/58 p-0.5"
                >
                  <button
                    type="button"
                    data-testid="agents-session-group-board"
                    aria-pressed={groupMode === "board"}
                    onClick={() => setGroupMode("board")}
                    className={cn(
                      "inline-flex h-11 items-center gap-1 rounded-[4px] px-2 text-[11px] font-[550] text-muted-foreground md:h-[25px]",
                      groupMode === "board" &&
                        "bg-hover text-foreground shadow-sm",
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
                      "inline-flex h-11 items-center gap-1 rounded-[4px] px-2 text-[11px] font-[550] text-muted-foreground md:h-[25px]",
                      groupMode === "token" &&
                        "bg-hover text-foreground shadow-sm",
                    )}
                  >
                    <KeyRound className="h-[11px] w-[11px]" aria-hidden />
                    {t("agents.groups.token")}
                  </button>
                </div>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {t("agents.groups.summary", {
                    count: displayed.length,
                    live: displayed.filter(isLiveSession).length,
                  })}
                </span>
              </div>
            </>
          ) : null}
          {(state.error || offline) && (
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
                    {t("agents.shell.partialError")}
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
          {section === "attention" && pending.error ? (
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
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="border-b border-border p-4">
                    <Skeleton variant="text" lines={2} />
                  </div>
                ))}
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
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="border-b border-border p-4">
                      <Skeleton variant="text" lines={2} />
                    </div>
                  ))}
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
                            href={docsUrl(lang)}
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
                  {runs.error ? (
                    <div
                      className="mb-2.5 flex flex-wrap items-center gap-3 rounded-[7px] border border-warning/35 bg-warning/6 px-2.5 py-2 text-[11px] text-foreground"
                      role="alert"
                      data-testid="agents-runs-stale"
                    >
                      <span>{t("agents.runs.stale")}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runs.reload}
                        className={`${SMALL_OUTLINE_CLASS} max-md:h-11 max-md:min-h-11`}
                      >
                        {t("agents.retry")}
                      </Button>
                    </div>
                  ) : null}
                  <RunList
                    rows={runs.rows}
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
                        : (runTokenNames.get(tokenId) ?? shortId(tokenId))
                    }
                    conflicts={runConflicts}
                  />
                  <div className="flex items-center justify-between gap-2 px-2 py-2.5 text-[11px] text-muted-foreground">
                    <span data-testid="agents-runs-footer-total">
                      {runs.hasMore
                        ? t("agents.runs.totalMore", { count: runs.total })
                        : t("agents.runs.footerCount", { count: runs.total })}
                    </span>
                    {runs.hasMore ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="agents-runs-more"
                        disabled={runs.loadingMore}
                        onClick={() => void runs.loadMore()}
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
                    ) : null}
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
                      <MemberAttentionBanner />
                    ) : (
                      <>
                        {showAllClear ? (
                          <AllClear
                            onViewSessions={() => setSection("sessions")}
                          />
                        ) : (
                          <AttentionApprovalList
                            rows={scopedApprovalRows}
                            filter={approvalFilter}
                            onFilterChange={setApprovalFilter}
                            selectedId={selectedApprovalId}
                            onSelect={openApproval}
                            onReject={(row) => openApproval(row, "reject")}
                            now={now}
                          />
                        )}
                      </>
                    )}
                    {groups.length === 0 ? (
                      filteredActive ? (
                        <FilteredEmpty onClear={clearFilters} />
                      ) : null
                    ) : (
                      <>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full bg-warning"
                          />
                          <h3 className="text-xs font-semibold">
                            {t("agents.shell.needsNudge")}
                          </h3>
                          <span className="text-[11px] text-muted-foreground">
                            {t("agents.shell.heartbeatHint")}
                          </span>
                        </div>
                        <AgentGroupList
                          boardGroups={boardGroups}
                          boards={state.boards}
                          staleBoardIds={state.staleBoardIds}
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
                    onSelect={openSession}
                    onOpenTokens={openTokens}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </section>
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
          "hidden shrink-0 flex-col border-l border-border bg-[color-mix(in_oklab,var(--surface)_48%,var(--background))] min-[1061px]:flex min-[1061px]:w-[324px] min-[1181px]:w-[352px]",
          ((section === "attention" &&
            selectedApprovalId !== null &&
            approvalBoardId !== null) ||
            sessionSheetOpen ||
            runSheetOpen) &&
            "max-[1060px]:absolute max-[1060px]:inset-y-0 max-[1060px]:right-0 max-[1060px]:z-50 max-[1060px]:flex max-[1060px]:w-[min(372px,100%)] max-[1060px]:border-l max-[1060px]:border-border max-[1060px]:bg-background max-[1060px]:pb-[env(safe-area-inset-bottom)] max-[760px]:w-full",
        )}
        aria-label={t("agents.shell.details")}
      >
        {section === "runs" ? (
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
                  : (runTokenNames.get(tokenId) ?? shortId(tokenId))
              }
              sessionLabel={(sessionId) =>
                sessionId === null
                  ? t("agentControl.runs.noSession")
                  : (runSessionNames.get(sessionId) ?? shortId(sessionId))
              }
              onClose={closeRun}
              onChanged={() => runs.reload()}
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
          selectedApprovalId !== null &&
          approvalBoardId !== null ? (
          <AttentionApprovalDetail
            boardId={approvalBoardId}
            approvalId={selectedApprovalId}
            boardTitle={approvalBoardTitle}
            fallbackAgentName={
              selectedApprovalBase === undefined
                ? undefined
                : approvalAgentNames.get(
                    selectedApprovalBase.requestedByTokenId,
                  )
            }
            fallbackCardTitle={selectedApprovalBase?.cardTitle ?? undefined}
            initialMode={approvalIntent}
            onChanged={pending.reload}
            onBack={closeApproval}
          />
        ) : section === "sessions" ? (
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

function AgentGroupList({
  boardGroups,
  boards,
  staleBoardIds,
}: {
  boardGroups: Array<{ id: string; title: string; groups: AgentGroup[] }>;
  boards: BoardSummary[];
  staleBoardIds: string[];
}) {
  return (
    <ul data-testid="agents-list" className="space-y-4">
      {boardGroups.map((board) => (
        <li key={board.id}>
          <h3 className="border-b border-border px-2 py-2 text-xs font-semibold text-muted-foreground">
            {board.title}
          </h3>
          <ul>
            {board.groups.map((group) => (
              <AgentRow
                key={group.tokenId}
                group={group}
                boards={boards}
                staleBoardIds={staleBoardIds}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function MemberAttentionBanner() {
  const { t } = useI18n();
  return (
    <div
      className="mt-0.5 flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5"
      data-testid="agents-member-note"
      role="status"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-[color:var(--agent-tone-primary)]">
        <Info className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <p className="min-w-0 pt-0.5 text-[11.5px] leading-[1.55] text-muted-foreground">
        <span className="font-semibold text-foreground">
          {t("agents.shell.memberNoteTitle")}
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

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="agents-filtered-empty"
      icon={<Search className="h-[18px] w-[18px]" />}
      title={t("agents.emptyFiltered")}
      body={t("agents.emptyFilteredBody")}
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

function AgentRow({
  group,
  boards,
  staleBoardIds,
}: {
  group: AgentGroup;
  boards: BoardSummary[];
  staleBoardIds: string[];
}) {
  const { t } = useI18n();
  const live = latestLiveSession(group);
  const statusRow =
    group.rows
      .slice()
      .sort(
        (a, b) =>
          (b.endedAt ?? b.lastHeartbeatAt) - (a.endedAt ?? a.lastHeartbeatAt),
      )[0] ?? group.rows[0];
  const board = boards.find((entry) => entry.id === statusRow.boardId);
  const paused = group.rows.find((row) => row.paused);
  return (
    <li>
      <Link
        to={routes.agent(group.tokenId)}
        data-testid="agent-row"
        data-agent-token={group.tokenId}
        className="grid min-w-0 gap-2 border-b border-border/70 px-2 py-3 transition-colors hover:bg-hover sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <div className="flex min-w-0 items-start gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-[color:var(--agent-tone-primary)]">
            <Bot className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{group.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[statusRow.clientName, statusRow.model]
                .filter(Boolean)
                .join(" · ") ||
                t("agents.tokenShort", { id: shortId(group.tokenId) })}
            </div>
            {group.liveCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-[color:var(--agent-tone-success)]">
                <AgentLiveDot />
                {t("agents.liveCount", { count: group.liveCount })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 text-xs">
          <p data-testid="agent-session-name" className="truncate font-medium">
            {statusRow.name ?? shortId(statusRow.id)}
          </p>
          <p className="truncate text-muted-foreground">
            {board?.title ?? statusRow.boardTitle}
          </p>
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          {live?.currentCardId ? (
            <p className="truncate text-foreground/80">
              {t("agents.currentCardShort", {
                title: live.cardTitle ?? shortId(live.currentCardId),
              })}
            </p>
          ) : live?.currentRunId ? (
            <p className="truncate">
              {t("agents.currentRunShort", { id: shortId(live.currentRunId) })}
            </p>
          ) : null}
          <AgentLastSeen at={group.lastSeen} prefix={t("agents.lastSeen")} />
        </div>
        <div className="flex flex-wrap items-start gap-1">
          <AgentStatusBadge status={statusRow.status} />
          {paused ? (
            <AgentPauseBadge
              scope={paused.pauseScope ?? "session"}
              title={paused.pausedReason ?? undefined}
            />
          ) : null}
          {group.rows.some((row) => row.stale) ? <AgentStaleBadge /> : null}
          {group.boardIds.some((id) => staleBoardIds.includes(id)) ? (
            <span className="text-xs text-[color:var(--agent-tone-warning)]">
              {t("agents.shell.staleData")}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
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
