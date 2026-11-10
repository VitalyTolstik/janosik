import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, RefreshCw } from "lucide-react";

import type { BoardSummary } from "@janosik/shared";

import { isApiEnabled } from "@/api/client";
import { AgentLastSeen, AgentLiveDot, AgentStatusBadge } from "./agents-ui";
import { AgentStaleBadge, AgentPauseBadge } from "./agents-ui";
import {
  AGENT_STATUS_FILTERS,
  AGENT_TIME_FILTERS,
  agentLabel,
  groupAgents,
  isLiveSession,
  latestLiveSession,
  matchesAgentFilter,
  readAgentFilter,
  shortId,
  type AgentFilter,
  type AgentGroup,
  type AgentStatusFilter,
  type AgentTimeFilter,
} from "./agent-model";
import { useAgentSessions } from "./use-agent-sessions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";

/**
 * Agents console (TASK-166.13): every agent session the caller can see,
 * grouped by personal token. The server lists sessions per board, so this page
 * merges the boards' lists, keeps them live through the `agent` SSE frames and
 * links each agent to its session detail.
 */
export function AgentsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const serverMode = isApiEnabled();
  const state = useAgentSessions();
  const filter = readAgentFilter(params);
  // The age window is evaluated from mount time; a reload re-evaluates it and
  // keeps `Date.now()` out of render (the hooks purity rule).
  const [now] = useState(() => Date.now());

  const setFilter = useCallback(
    (patch: Partial<AgentFilter>) => {
      const next = { ...filter, ...patch };
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          setOrDelete(search, "board", next.board, "all");
          setOrDelete(search, "token", next.token, "all");
          setOrDelete(search, "status", next.status, "all");
          setOrDelete(search, "time", next.time, "any");
          setOrDelete(search, "q", next.query, "");
          return search;
        },
        { replace: true },
      );
    },
    [filter, setParams],
  );

  const filtered = useMemo(
    () => state.rows.filter((row) => matchesAgentFilter(row, filter, now)),
    [filter, now, state.rows],
  );
  const groups = useMemo(() => groupAgents(filtered), [filtered]);
  const stats = useMemo(
    () => ({
      agents: groups.length,
      live: filtered.filter(isLiveSession).length,
      waiting: filtered.filter((row) => row.status === "waiting_approval")
        .length,
      stale: filtered.filter((row) => row.stale).length,
    }),
    [filtered, groups.length],
  );

  const boardOptions = useMemo(
    () => [
      { value: "all", label: t("agents.filters.allBoards") },
      ...state.boards.map((board) => ({ value: board.id, label: board.title })),
    ],
    [state.boards, t],
  );
  const tokenOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of state.rows) {
      if (!seen.has(row.apiTokenId)) seen.set(row.apiTokenId, agentLabel(row));
    }
    return [
      { value: "all", label: t("agents.filters.allTokens") },
      ...[...seen.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [state.rows, t]);
  const statusOptions = useMemo(
    () =>
      AGENT_STATUS_FILTERS.map((value) => ({
        value,
        label:
          value === "all"
            ? t("agents.filters.allStatuses")
            : value === "live"
              ? t("agents.filters.live")
              : value === "stale"
                ? t("agents.filters.stale")
                : t(`agents.status.${value}`),
      })),
    [t],
  );
  const timeOptions = useMemo(
    () =>
      AGENT_TIME_FILTERS.map((value) => ({
        value,
        label:
          value === "any"
            ? t("agents.filters.anyTime")
            : value === "1h"
              ? t("agents.filters.lastHour")
              : value === "24h"
                ? t("agents.filters.lastDay")
                : value === "7d"
                  ? t("agents.filters.lastWeek")
                  : t("agents.filters.lastMonth"),
      })),
    [t],
  );

  const filteredActive =
    filter.board !== "all" ||
    filter.token !== "all" ||
    filter.status !== "all" ||
    filter.time !== "any" ||
    filter.query.trim() !== "";

  if (!serverMode) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          {t("agents.unavailable")}
        </p>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-0 w-full flex-1 flex-col px-4 pt-4 pb-4 sm:px-6"
      data-testid="agents-page"
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-primary">
              <Bot className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
                {t("agents.title")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("agents.subtitle")}
              </p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => state.reload()}
          disabled={state.refreshing}
          data-testid="agents-refresh"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", state.refreshing && "animate-spin")}
            aria-hidden
          />
          {state.refreshing ? t("agents.refreshing") : t("agents.refresh")}
        </Button>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={t("agents.stats.agents")}
          value={stats.agents}
          testId="agents-stat-agents"
        />
        <Stat
          label={t("agents.stats.live")}
          value={stats.live}
          testId="agents-stat-live"
          tone="success"
        />
        <Stat
          label={t("agents.stats.waiting")}
          value={stats.waiting}
          testId="agents-stat-waiting"
          tone="warning"
        />
        <Stat
          label={t("agents.stats.stale")}
          value={stats.stale}
          testId="agents-stat-stale"
          tone="warning"
        />
      </div>

      <div
        className="mb-3 flex flex-wrap items-end gap-2"
        data-testid="agents-filters"
      >
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-[11px] text-muted-foreground sm:max-w-52">
          {t("agents.filters.board")}
          <SelectField
            value={filter.board}
            options={boardOptions}
            onChange={(value) => setFilter({ board: value })}
            ariaLabel={t("agents.filters.board")}
            testId="agents-filter-board"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-[11px] text-muted-foreground sm:max-w-52">
          {t("agents.filters.token")}
          <SelectField
            value={filter.token}
            options={tokenOptions}
            onChange={(value) => setFilter({ token: value })}
            ariaLabel={t("agents.filters.token")}
            testId="agents-filter-token"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-[11px] text-muted-foreground sm:max-w-44">
          {t("agents.filters.status")}
          <SelectField
            value={filter.status}
            options={statusOptions}
            onChange={(value) =>
              setFilter({ status: value as AgentStatusFilter })
            }
            ariaLabel={t("agents.filters.status")}
            testId="agents-filter-status"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-[11px] text-muted-foreground sm:max-w-44">
          {t("agents.filters.time")}
          <SelectField
            value={filter.time}
            options={timeOptions}
            onChange={(value) => setFilter({ time: value as AgentTimeFilter })}
            ariaLabel={t("agents.filters.time")}
            testId="agents-filter-time"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex min-w-44 flex-[2] flex-col gap-1 text-[11px] text-muted-foreground">
          {t("agents.filters.search")}
          <Input
            type="search"
            value={filter.query}
            onChange={(event) => setFilter({ query: event.target.value })}
            placeholder={t("agents.filters.searchPlaceholder")}
            className="h-8 text-xs"
            data-testid="agents-search"
          />
        </label>
      </div>

      {state.error ? (
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs",
            state.rows.length === 0
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-warning/40 bg-warning/10 text-warning",
          )}
          data-testid="agents-error"
          role="alert"
        >
          <span>
            {state.rows.length === 0
              ? t("agents.error.title")
              : t("agents.error.stale")}
          </span>
          <button
            type="button"
            onClick={() => state.reload()}
            className="rounded-sm border border-current/40 px-2 py-0.5 text-[11px] font-medium hover:bg-current/10"
            data-testid="agents-retry"
          >
            {t("agents.retry")}
          </button>
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        aria-busy={state.refreshing}
      >
        {state.loading ? (
          <SkeletonRegion
            label={t("agents.loading")}
            testId="agents-loading"
            contentClassName="space-y-2"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="rounded-xl border border-border bg-card/70 p-4"
              >
                <Skeleton variant="text" lines={2} />
              </div>
            ))}
          </SkeletonRegion>
        ) : state.rows.length === 0 ? (
          state.error ? null : (
            <EmptyState
              testId="agents-empty"
              title={t("agents.empty.title")}
              body={t("agents.empty.body")}
            />
          )
        ) : groups.length === 0 ? (
          <EmptyState
            testId="agents-filtered-empty"
            title={t("agents.emptyFiltered")}
            body={t("agents.emptyFilteredBody")}
            action={
              filteredActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFilter({
                      board: "all",
                      token: "all",
                      status: "all",
                      time: "any",
                      query: "",
                    })
                  }
                  data-testid="agents-clear-filters"
                >
                  {t("agents.clearFilters")}
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="space-y-2" data-testid="agents-list">
            {groups.map((group) => (
              <AgentRow
                key={group.tokenId}
                group={group}
                boards={state.boards}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function AgentRow({
  group,
  boards,
}: {
  group: AgentGroup;
  boards: BoardSummary[];
}) {
  const { t } = useI18n();
  const boardTitles = new Map(boards.map((board) => [board.id, board.title]));
  const live = latestLiveSession(group);
  const statusRow =
    group.rows
      .slice()
      .sort(
        (a, b) =>
          (b.endedAt ?? b.lastHeartbeatAt) - (a.endedAt ?? a.lastHeartbeatAt),
      )[0] ?? group.rows[0];
  const paused = group.rows.find((row) => row.paused === true);
  return (
    <li>
      <Link
        to={routes.agent(group.tokenId)}
        className="group block rounded-xl border border-border bg-card/75 p-3.5 transition-colors hover:border-primary/40 hover:bg-card sm:p-4"
        data-testid="agent-row"
        data-agent-token={group.tokenId}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60 text-primary">
              <Bot className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">
                  {group.name}
                </span>
                {group.liveCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                    <AgentLiveDot />
                    {t("agents.liveCount", { count: group.liveCount })}
                  </span>
                ) : null}
                {paused ? (
                  <AgentPauseBadge
                    scope={paused.pauseScope ?? "session"}
                    title={paused.pausedReason ?? undefined}
                  />
                ) : null}
                {group.rows.some((row) => row.stale) ? (
                  <AgentStaleBadge />
                ) : (
                  <AgentStatusBadge status={statusRow.status} />
                )}
              </div>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                <span title={group.tokenId}>
                  {t("agents.tokenShort", { id: shortId(group.tokenId) })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {t("agents.sessionCount", { count: group.rows.length })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {t("agents.boardCount", { count: group.boardIds.length })}
                </span>
              </p>
              {statusRow.name ? (
                <p
                  className="mt-1 truncate text-xs text-foreground/80"
                  data-testid="agent-session-name"
                >
                  {statusRow.name}
                </p>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
            <AgentLastSeen at={group.lastSeen} prefix={t("agents.lastSeen")} />
            {live?.currentCardId ? (
              <span
                className="max-w-52 truncate text-foreground/80"
                title={live.cardTitle ?? live.currentCardId}
              >
                {t("agents.currentCardShort", {
                  title: live.cardTitle ?? shortId(live.currentCardId),
                })}
              </span>
            ) : live?.currentRunId ? (
              <span
                className="max-w-52 truncate font-mono"
                title={live.currentRunId}
              >
                {t("agents.currentRunShort", {
                  id: shortId(live.currentRunId),
                })}
              </span>
            ) : live === undefined ? (
              <span className="text-muted-foreground/70">
                {t("agents.noLiveSession")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {group.boardIds.map((boardId) => (
            <span
              key={boardId}
              className="rounded-md border border-border/70 bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {boardTitles.get(boardId) ?? shortId(boardId)}
            </span>
          ))}
          {group.waitingCount > 0 ? (
            <span className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
              {t("agents.waitingCount", { count: group.waitingCount })}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function Stat({
  label,
  value,
  testId,
  tone = "default",
}: {
  label: string;
  value: number;
  testId: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-card/70 px-3 py-2">
      <div
        data-testid={testId}
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function EmptyState({
  testId,
  title,
  body,
  action,
}: {
  testId: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 px-4 py-16 text-center"
      data-testid={testId}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{body}</p>
      {action}
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
