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
  Bot,
  ChevronRight,
  History,
  Inbox,
  Info,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { BoardSummary } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
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
  latestLiveSession,
  matchesAgentFilter,
  readAgentFilter,
  shortId,
  type AgentFilter,
  type AgentGroup,
  type AgentStatusFilter,
} from "./agent-model";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { formatRelative, useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { boardColor } from "@/utils/board-color";
import { docsUrl } from "@/utils/docs-url";

type Section = "attention" | "sessions" | "runs";
const SECTIONS = ["attention", "sessions", "runs"] as const;

export function AgentsPage() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const state = useAgentSessions();
  const filter = useMemo(() => readAgentFilter(params), [params]);
  const sectionParam = params.get("section");
  const section: Section = SECTIONS.includes(sectionParam as Section)
    ? (sectionParam as Section)
    : "attention";
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [approvalIntent, setApprovalIntent] = useState<"reject" | null>(null);

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
          if ("board" in patch) {
            search.delete("approval");
            search.delete("run");
            search.delete("session");
          }
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setSection = (value: Section) => {
    setParams((current) => {
      const search = new URLSearchParams(current);
      setOrDelete(search, "section", value, "attention");
      for (const key of ["session", "agent", "approval", "run"])
        search.delete(key);
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

  const pending = usePendingApprovals(state.boards, !state.isAgentToken);
  const runs = useAgentRuns(state.boards, section === "runs");
  const [approvalFilter, setApprovalFilter] =
    useState<AttentionApprovalFilter>("needs");
  const approvalAgentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const token of state.tokens) names.set(token.id, token.name);
    for (const row of state.rows) names.set(row.apiTokenId, agentLabel(row));
    return names;
  }, [state.rows, state.tokens]);
  const approvalBoardIds = useMemo(
    () => [...new Set(pending.rows.map((row) => row.boardId))],
    [pending.rows],
  );
  const [loadedApprovalCards, setLoadedApprovalCards] = useState<
    Map<string, string>
  >(() => new Map());
  useEffect(() => {
    if (approvalBoardIds.length === 0) return;
    let alive = true;
    void Promise.allSettled(
      approvalBoardIds.map((boardId) => api.getBoard(boardId)),
    ).then((results) => {
      if (!alive) return;
      const titles = new Map<string, string>();
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const card of Object.values(result.value.cards)) {
          titles.set(card.id, card.title);
        }
      }
      setLoadedApprovalCards(titles);
    });
    return () => {
      alive = false;
    };
  }, [approvalBoardIds]);
  const approvalCardTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const row of state.rows) {
      if (row.currentCardId !== null && row.cardTitle !== null) {
        titles.set(row.currentCardId, row.cardTitle);
      }
    }
    for (const [cardId, title] of loadedApprovalCards) {
      if (!titles.has(cardId)) titles.set(cardId, title);
    }
    return titles;
  }, [loadedApprovalCards, state.rows]);
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
        cardTitle:
          row.cardId === null ? undefined : approvalCardTitles.get(row.cardId),
      }));
  }, [
    approvalAgentNames,
    approvalCardTitles,
    filter.board,
    filter.query,
    filter.token,
    pending.rows,
  ]);
  const pendingAll = state.boards
    .filter((board) => board.role === "ADMIN")
    .reduce((total, board) => total + (pending.counts[board.id] ?? 0), 0);
  const pendingForScope =
    filter.board === "all" ? pendingAll : (pending.counts[filter.board] ?? 0);
  const scopedRows = useMemo(
    () =>
      filter.board === "all"
        ? state.rows
        : state.rows.filter((row) => row.boardId === filter.board),
    [filter.board, state.rows],
  );
  const staleCount = scopedRows.filter((row) => row.stale).length;
  const attentionCount = pendingForScope + staleCount;
  const sessionCount = scopedRows.length;
  const hasAdminBoard = state.boards.some((board) => board.role === "ADMIN");
  const isAttentionAdmin =
    filter.board === "all"
      ? hasAdminBoard
      : state.boards.find((board) => board.id === filter.board)?.role ===
        "ADMIN";

  const selectedSession = params.get("session");
  const selectedApprovalId = params.get("approval");
  const approvalBoardId = params.get("board");
  const selectedApprovalBase =
    selectedApprovalId === null
      ? undefined
      : pending.rows.find((row) => row.id === selectedApprovalId);
  const approvalBoardTitle =
    selectedApprovalBase?.boardTitle ??
    state.boards.find((board) => board.id === approvalBoardId)?.title ??
    "";
  const filtered = useMemo(
    () =>
      state.rows.filter(
        (row) =>
          matchesAgentFilter(row, filter, now) &&
          (selectedSession === null || row.id === selectedSession),
      ),
    [state.rows, filter, selectedSession, now],
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
  const filteredActive =
    filter.token !== "all" ||
    filter.status !== "all" ||
    filter.time !== "any" ||
    filter.query.trim() !== "" ||
    selectedSession !== null;
  const unknownBoard =
    !state.loading &&
    (!state.error || state.errorStatus === 403 || state.errorStatus === 404) &&
    filter.board !== "all" &&
    !state.boards.some((board) => board.id === filter.board);
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
      className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto font-agent-surface md:flex-row md:overflow-hidden"
      data-testid="agents-page"
    >
      <aside className="flex shrink-0 flex-col border-b border-border bg-card/40 px-[10px] pb-3 pt-4 md:w-[208px] md:border-r md:border-b-0 xl:w-[222px]">
        <div className="hidden px-1 pb-3 md:block">
          <h1 className="font-display text-[17px] font-bold leading-[1.15] tracking-[-0.025em]">
            {t("agents.title")}
          </h1>
          <p className="mt-[3px] max-w-[19ch] text-[11px] leading-[1.45] text-muted-foreground">
            {t("agents.shell.tagline")}
          </p>
        </div>
        <nav
          role="tablist"
          aria-label={t("agents.title")}
          className="flex gap-1 md:flex-col"
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
                  "flex min-h-11 flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left font-agent-surface text-[12px] font-[550] leading-[1.45] text-muted-foreground hover:bg-hover hover:text-foreground md:min-h-[34px] md:flex-none",
                  section === item &&
                    "border-border bg-surface text-foreground shadow-[inset_2px_0_0_var(--primary)]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {t(`agents.shell.${item}`)}
                {count > 0 ? (
                  <span
                    data-testid={`agents-count-${item}`}
                    className={cn(
                      "ml-auto inline-grid h-[17px] min-w-[18px] place-items-center rounded px-1 text-[10.5px] font-semibold tabular-nums",
                      item === "attention"
                        ? "border border-warning/30 bg-warning/10 text-warning"
                        : section === item
                          ? "bg-primary/15 text-primary"
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
        <div className="mt-4 hidden border-t border-border pt-3 md:block">
          <p className="flex items-center justify-between px-2 pb-[5px] font-agent-surface text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
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
                  : (pending.counts[board.value] ?? 0);
              return (
                <button
                  key={board.value}
                  type="button"
                  onClick={() => setFilter({ board: board.value })}
                  aria-pressed={filter.board === board.value}
                  className={cn(
                    "flex min-h-8 w-full items-center gap-[7px] rounded-md border border-transparent px-2 text-left font-agent-surface text-[11.5px] font-normal leading-[1.45] text-muted-foreground hover:bg-hover hover:text-foreground",
                    filter.board === board.value &&
                      "border-border/60 bg-hover/60 text-foreground",
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
                  {count > 0 ? (
                    <span className="inline-grid h-4 min-w-4 place-items-center rounded border border-warning/25 bg-warning/10 px-1 text-[10px] font-semibold tabular-nums text-warning">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-auto hidden border-t border-border px-2 pt-3 text-[10.5px] leading-[1.5] text-muted-foreground md:block">
          <p>{t("agents.shell.tokenHint")}</p>
          <button
            type="button"
            onClick={openTokens}
            className="mt-2 min-h-9 text-[11px] font-semibold text-foreground hover:underline"
          >
            {t("agents.shell.manageTokens")} ↗
          </button>
        </div>
      </aside>
      <section
        id="agents-panel"
        role="tabpanel"
        aria-labelledby={`agents-tab-${section}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 flex-col px-[14px] pb-6 pt-4 min-[1181px]:px-[18px]">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-[18px] font-bold leading-[1.2] tracking-[-0.025em]">
                {t(`agents.shell.${section}`)}
              </h2>
              <p className="mt-[3px] text-[11.5px] leading-[1.45] text-muted-foreground">
                {section === "attention"
                  ? t("agents.shell.tagline")
                  : section === "sessions"
                    ? t("agents.shell.sessionsDescription")
                    : t("agents.shell.runsDescription")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
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
                  if (section === "runs") runs.reload();
                }}
                disabled={
                  state.refreshing || (section === "runs" && runs.loading)
                }
                data-testid="agents-refresh"
                className="min-h-11 md:h-7 md:min-h-7"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    state.refreshing && "animate-spin",
                  )}
                  aria-hidden
                />
                {state.refreshing
                  ? t("agents.refreshing")
                  : t("agents.refresh")}
              </Button>
              {section === "sessions" ? (
                <button
                  type="button"
                  onClick={openTokens}
                  className="inline-flex min-h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground max-[639px]:hidden min-[1061px]:max-[1279px]:hidden"
                >
                  {t("agents.shell.manageTokens")}
                </button>
              ) : null}
              {section === "runs" ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  data-testid="agents-runs-clear-all"
                  className="inline-flex min-h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground max-[639px]:hidden min-[1061px]:max-[1279px]:hidden"
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
                    className="min-h-11 rounded-md border-border bg-[color-mix(in_oklab,var(--background)_38%,var(--surface))] pr-2 pl-[27px] text-[11.5px] shadow-none placeholder:text-muted-foreground/78 focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/15 md:h-[30px] md:min-h-[30px]"
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
                  className="min-h-11 w-auto min-w-[96px] text-[11px] md:h-7 md:min-h-7"
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
                  className="min-h-11 w-auto min-w-[96px] text-[11px] md:h-7 md:min-h-7"
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
                  className="w-auto min-w-[108px]"
                  counts={pending.counts}
                  totalCount={pendingAll}
                />
              </>
            ) : (
              <>
                {[
                  t("agents.filters.allStatuses"),
                  t("agents.shell.allKinds"),
                  t("agents.filters.anyTime"),
                  t("agents.filters.allTokens"),
                  t("agents.shell.allSessions"),
                ].map((label) => (
                  <SelectField
                    key={label}
                    value="all"
                    options={[{ value: "all", label }]}
                    onChange={() => {}}
                    disabled
                    ariaLabel={label}
                    testId={`agents-runs-filter-${label}`}
                    chevronClassName="h-[11px] w-[11px]"
                    className="min-h-11 w-auto min-w-[104px] text-xs md:h-7 md:min-h-7"
                  />
                ))}
                <span className="ml-auto text-[10.5px] text-muted-foreground">
                  {t("agents.runs.shown", {
                    count: runs.loading ? 0 : runs.rows.length,
                  })}
                </span>
              </>
            )}
          </div>
          {(state.error || offline) && (
            <div
              className={cn(
                "mb-2.5 flex flex-wrap items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45]",
                state.rows.length === 0
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-warning/35 bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] text-foreground",
              )}
              data-testid="agents-error"
              role="alert"
            >
              <AlertTriangle
                className={cn(
                  "mt-px h-3.5 w-3.5 shrink-0",
                  state.rows.length === 0 ? "text-danger" : "text-warning",
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
              className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              data-testid="agents-approvals-error"
              role="alert"
            >
              <span>{t("agentControl.approvals.loadError")}</span>
              <button
                type="button"
                onClick={pending.reload}
                className="min-h-9 rounded-sm border border-current/40 px-2 font-medium"
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
                    onClick={() => setFilter({ board: "all" })}
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
                  body={t("agents.error.stale")}
                  action={
                    <Button variant="outline" onClick={runs.reload}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      {t("agents.retry")}
                    </Button>
                  }
                />
              ) : runs.rows.length === 0 ? (
                <EmptyState
                  testId="agents-runs-empty"
                  icon={<History className="h-[18px] w-[18px]" />}
                  title={t("agents.runs.emptyTitle")}
                  body={t("agents.runs.emptyBody")}
                  action={
                    <>
                      <Button
                        variant="outline"
                        onClick={clearFilters}
                        data-testid="agents-runs-empty-clear"
                      >
                        {t("agents.clearFilters")}
                      </Button>
                      <Button variant="ghost" asChild>
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
              ) : (
                <>
                  {runs.error ? (
                    <div
                      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
                      role="alert"
                    >
                      <span>{t("agents.error.stale")}</span>
                      <Button variant="outline" size="sm" onClick={runs.reload}>
                        {t("agents.retry")}
                      </Button>
                    </div>
                  ) : null}
                  <ul
                    data-testid="agents-runs-list"
                    className="divide-y divide-border border-y border-border"
                  >
                    {runs.rows.map((run) => (
                      <li
                        key={run.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-xs"
                      >
                        <span className="font-medium">
                          {t(`agentControl.runs.kind.${run.kind}`)}
                        </span>
                        <span className="text-muted-foreground">
                          {run.boardTitle}
                        </span>
                        <span className="text-muted-foreground">
                          {t("agentControl.runs.commands", {
                            count: run.commandCount,
                          })}
                        </span>
                        <span
                          className={cn(
                            "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                            run.status === "applied"
                              ? "border-success/40 bg-success/10 text-success"
                              : run.status === "reverted"
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-danger/40 bg-danger/10 text-danger",
                          )}
                        >
                          {t(`agentControl.runs.status.${run.status}`)}
                        </span>
                        <time className="text-muted-foreground">
                          {formatRelative(run.createdAt, lang)}
                        </time>
                      </li>
                    ))}
                  </ul>
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
                        {scopedApprovalRows.length === 0 &&
                        !filteredActive &&
                        !state.error &&
                        !pending.error &&
                        !pending.loading ? (
                          <AllClear
                            onViewSessions={() => setSection("sessions")}
                          />
                        ) : null}
                        <AttentionApprovalList
                          rows={scopedApprovalRows}
                          filter={approvalFilter}
                          onFilterChange={setApprovalFilter}
                          selectedId={selectedApprovalId}
                          onSelect={openApproval}
                          onReject={(row) => openApproval(row, "reject")}
                          now={now}
                        />
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
                ) : groups.length === 0 ? (
                  <FilteredEmpty onClear={clearFilters} />
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      {t("agents.shell.sessionsHint")}
                    </p>
                    <AgentGroupList
                      boardGroups={boardGroups}
                      boards={state.boards}
                      staleBoardIds={state.staleBoardIds}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-l border-border bg-card/30 min-[1061px]:flex min-[1061px]:w-[324px] min-[1181px]:w-[352px]",
          section === "attention" &&
            selectedApprovalId !== null &&
            approvalBoardId !== null &&
            "max-[1060px]:fixed max-[1060px]:inset-0 max-[1060px]:z-50 max-[1060px]:flex max-[1060px]:w-full max-[1060px]:border-l-0 max-[1060px]:bg-background",
        )}
        aria-label={t("agents.shell.details")}
      >
        {section === "attention" &&
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
            fallbackCardTitle={
              selectedApprovalBase?.cardId == null
                ? undefined
                : approvalCardTitles.get(selectedApprovalBase.cardId)
            }
            initialMode={approvalIntent}
            onChanged={pending.reload}
            onBack={closeApproval}
          />
        ) : (
          <>
            <header className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("agents.shell.detailEyebrow")}
              </p>
              <h2 className="mt-0.5 text-[13px] font-semibold">
                {t("agents.shell.noSelection")}
              </h2>
            </header>
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
                <KeyRound className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <p className="text-[13px] font-semibold text-foreground">
                {t("agents.shell.noSessionsToInspect")}
              </p>
              <p className="max-w-[30ch] text-[11.5px] leading-[1.55] text-muted-foreground">
                {t("agents.shell.noSessionsBody")}
              </p>
              <Button size="sm" onClick={openTokens} className="mt-1">
                {t("agents.shell.createKey")}
              </Button>
            </div>
          </>
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
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
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
      className="mt-0.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5"
      data-testid="agents-attention-clear"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-success/30 bg-success/10 text-success">
        <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold">
          {t("agents.shell.allClear")}
        </p>
        <p className="text-[10.5px] leading-[1.45] text-muted-foreground">
          {t("agents.shell.allClearBody")}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onViewSessions}>
        {t("agents.shell.viewSessions")}
        <ChevronRight className="h-3 w-3" aria-hidden />
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
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("agents.retry")}
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
          <Button onClick={onOpenTokens}>{t("agents.shell.createKey")}</Button>
          <Button variant="outline" asChild>
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
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-primary">
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
              <span className="inline-flex items-center gap-1 text-xs text-success">
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
            <span className="text-xs text-warning">
              {t("agents.shell.staleData")}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
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
      <span className="mb-0.5 grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
        {icon ?? <Bot className="h-[18px] w-[18px]" aria-hidden />}
      </span>
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <p className="max-w-[42ch] text-[11.5px] leading-[1.55] text-muted-foreground">
        {body}
      </p>
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
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
