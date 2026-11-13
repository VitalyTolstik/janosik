import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, Info, Loader2, RefreshCw } from "lucide-react";
import type {
  AgentSessionDto,
  BoardRole,
  RunSummaryDto,
  UserTokenDto,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { useBoardState } from "@/store/BoardContext";
import {
  EMPTY_RUN_FILTER,
  hasRunFilter,
  runFilterOptions,
  type AgentRunFilter,
  type RunBoardScope,
  type RunKindFilter,
  type RunStatusFilter,
  type RunTimeFilter,
} from "../agents/run-model";
import { RunDetail, RunList } from "../agents/run-ui";
import { useAgentRuns } from "../agents/use-agent-runs";

type Role = BoardRole | undefined;

/**
 * Board-scoped Runs tab (TASK-179.5). The surface is shared with `/agents`:
 * the same status/kind/time/token/session filters, list and detail. Preview is
 * available to every member; applying a rollback remains board-ADMIN only.
 */
export function RunsPanel({ role }: { role: Role }) {
  const { t } = useI18n();
  const { board } = useBoardState();
  const boardId = board?.id;
  const boardTitle = board?.title;
  const [filter, setFilter] = useState<AgentRunFilter>(EMPTY_RUN_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [conflicts, setConflicts] = useState<Map<string, number>>(
    () => new Map(),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [sessions, setSessions] = useState<AgentSessionDto[]>([]);
  const [tokens, setTokens] = useState<UserTokenDto[]>([]);

  const scope = useMemo<RunBoardScope[]>(
    () =>
      boardId === undefined
        ? []
        : [
            {
              id: boardId,
              title: boardTitle ?? boardId,
              role: role ?? "VIEWER",
            },
          ],
    [boardId, boardTitle, role],
  );

  useEffect(() => {
    if (boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    void Promise.all([
      api.listAgentSessions(boardId).catch(() => [] as AgentSessionDto[]),
      api.listTokens().catch(() => [] as UserTokenDto[]),
    ]).then(([nextSessions, nextTokens]) => {
      if (!alive) return;
      setSessions(nextSessions);
      setTokens(nextTokens);
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  const runs = useAgentRuns(scope, {
    enabled: board !== undefined && isApiEnabled(),
    filter,
  });
  const options = useMemo(() => runFilterOptions(t), [t]);
  const tokenNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const token of tokens) names.set(token.id, token.name);
    for (const session of sessions) {
      if (names.has(session.apiTokenId)) continue;
      names.set(
        session.apiTokenId,
        session.name ?? session.clientName ?? shortId(session.apiTokenId),
      );
    }
    return names;
  }, [sessions, tokens]);
  const sessionNames = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          session.name ?? shortId(session.id),
        ]),
      ),
    [sessions],
  );
  const tokenLabel = (tokenId: string | null): string =>
    tokenId === null
      ? t("agentControl.runs.noToken")
      : (tokenNames.get(tokenId) ?? shortId(tokenId));
  const sessionLabel = (sessionId: string | null): string =>
    sessionId === null
      ? t("agentControl.runs.noSession")
      : (sessionNames.get(sessionId) ?? shortId(sessionId));
  const tokenOptions = useMemo(
    () => [
      { value: "all", label: t("agents.filters.allTokens") },
      ...[...tokenNames.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(filter.token !== "all" && !tokenNames.has(filter.token)
        ? [{ value: filter.token, label: shortId(filter.token) }]
        : []),
    ],
    [filter.token, t, tokenNames],
  );
  const sessionOptions = useMemo(
    () => [
      { value: "all", label: t("agents.shell.allSessions") },
      ...[...sessionNames.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(filter.session !== "all" && !sessionNames.has(filter.session)
        ? [{ value: filter.session, label: shortId(filter.session) }]
        : []),
    ],
    [filter.session, sessionNames, t],
  );

  const patch = (next: Partial<AgentRunFilter>) => {
    setFilter((current) => ({ ...current, ...next }));
    setSelectedId(null);
    setMobileDetailOpen(false);
  };
  const clearFilters = () => {
    setFilter(EMPTY_RUN_FILTER);
    setSelectedId(null);
    setMobileDetailOpen(false);
  };
  // Pin the open run when a refresh prepends a newer row (for example the
  // revert run created by `run.reverted`). Only fall back to the newest row
  // when the selected one is gone: a filter change or a revoked board.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pin the open run across list refreshes
    setSelectedId((current) =>
      current !== null && runs.rows.some((row) => row.id === current)
        ? current
        : (runs.rows[0]?.id ?? null),
    );
  }, [runs.rows]);
  const selected: RunSummaryDto | null =
    runs.rows.find((row) => row.id === selectedId) ?? runs.rows[0] ?? null;
  const noteConflicts = (runId: string, count: number) => {
    setConflicts((current) => {
      const next = new Map(current);
      next.set(runId, count);
      return next;
    });
  };

  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground">
        {t("agentControl.runs.offline")}
      </p>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-runs-panel"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2.5 py-[7px]">
        <h3 className="text-[13px] font-[650]">{t("agents.shell.runs")}</h3>
        <span className="text-[11px] text-muted-foreground">
          {runs.loading
            ? t("agentControl.runs.loading")
            : t("agents.runs.boardHistory", {
                count: runs.total,
              })}
        </span>
        <button
          type="button"
          onClick={runs.reload}
          disabled={runs.loading}
          aria-label={t("agents.runs.refresh")}
          data-testid="agent-runs-refresh"
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground md:h-7 md:w-7"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", runs.loading && "animate-spin")}
            aria-hidden
          />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-[5px] border-b border-border px-2.5 py-[7px]">
        <SelectField
          value={filter.status}
          options={options.status}
          onChange={(value) => patch({ status: value as RunStatusFilter })}
          ariaLabel={t("agentControl.runs.filter.status")}
          testId="run-filter-status"
          className="h-11 w-auto min-w-[104px] text-[11px] md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.kind}
          options={options.kind}
          onChange={(value) => patch({ kind: value as RunKindFilter })}
          ariaLabel={t("agentControl.runs.filter.kind")}
          testId="run-filter-kind"
          className="h-11 w-auto min-w-[96px] text-[11px] md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.time}
          options={options.time}
          onChange={(value) => patch({ time: value as RunTimeFilter })}
          ariaLabel={t("agentControl.runs.filter.time")}
          testId="run-filter-time"
          className="h-11 w-auto min-w-[92px] text-[11px] md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.token}
          options={tokenOptions}
          onChange={(value) => patch({ token: value })}
          ariaLabel={t("agentControl.runs.filter.token")}
          testId="run-filter-token"
          className="h-11 w-auto min-w-[104px] max-w-[148px] text-[11px] md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.session}
          options={sessionOptions}
          onChange={(value) => patch({ session: value })}
          ariaLabel={t("agentControl.runs.filter.session")}
          testId="run-filter-session"
          className="h-11 w-auto min-w-[104px] max-w-[148px] text-[11px] md:h-[26px] md:min-h-[26px]"
        />
        <button
          type="button"
          onClick={clearFilters}
          data-testid="agent-runs-clear-filters"
          className="inline-flex min-h-11 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground md:min-h-[26px]"
        >
          {t("agents.runs.clearAll")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          data-testid="agent-run-list"
          className={cn(
            "min-h-0 w-full overflow-y-auto border-border md:w-[286px] md:flex-none md:border-r",
            mobileDetailOpen && "hidden md:block",
          )}
        >
          {runs.loading ? (
            <SkeletonRegion
              label={t("agentControl.runs.loading")}
              testId="agent-runs-skeleton"
            >
              <div className="space-y-2 p-3" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <div
                    key={index}
                    className="space-y-1.5 rounded-md border border-border/60 p-2"
                  >
                    <Skeleton width={130} height={11} />
                    <Skeleton width={180} height={10} />
                  </div>
                ))}
              </div>
            </SkeletonRegion>
          ) : runs.error && runs.rows.length === 0 ? (
            <div className="space-y-2 p-4" data-testid="agent-runs-error">
              <p className="text-[11px] text-danger">
                {t("agentControl.runs.loadError")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={runs.reload}
                data-testid="agent-runs-retry"
                className="max-md:min-h-11"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.retry")}
              </Button>
            </div>
          ) : runs.rows.length === 0 ? (
            hasRunFilter(filter) ? (
              <div
                className="flex flex-col items-center gap-2 px-4 py-10 text-center"
                data-testid="agent-runs-filtered-empty"
              >
                <History
                  className="h-6 w-6 text-muted-foreground/60"
                  aria-hidden
                />
                <p className="text-[11px] font-medium text-foreground">
                  {t("agents.runs.noMatch")}
                </p>
                <p className="max-w-[32ch] text-[11px] leading-[1.5] text-muted-foreground">
                  {t("agents.runs.noMatchBody")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearFilters}
                  data-testid="agent-runs-empty-clear"
                  className="max-md:min-h-11"
                >
                  {t("agents.clearFilters")}
                </Button>
              </div>
            ) : (
              <div
                className="flex flex-col items-center gap-2 px-4 py-10 text-center"
                data-testid="agent-runs-empty"
              >
                <History
                  className="h-6 w-6 text-muted-foreground/60"
                  aria-hidden
                />
                <p className="text-[11px] font-medium text-foreground">
                  {t("agentControl.runs.empty")}
                </p>
                <p className="max-w-[32ch] text-[11px] leading-[1.5] text-muted-foreground">
                  {t("agents.runs.emptyBody")}
                </p>
              </div>
            )
          ) : (
            <>
              {runs.error ? (
                <div
                  role="alert"
                  className="m-2 flex flex-wrap items-center gap-2 rounded-[7px] border border-warning/35 bg-warning/6 px-2.5 py-2 text-[11px] text-foreground"
                >
                  <span className="min-w-0 flex-1">
                    {t("agents.runs.stale")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runs.reload}
                    className="max-md:min-h-11"
                  >
                    {t("agentControl.retry")}
                  </Button>
                </div>
              ) : null}
              <RunList
                rows={runs.rows}
                selectedId={selected?.id ?? null}
                onSelect={(run) => {
                  setSelectedId(run.id);
                  setMobileDetailOpen(true);
                }}
                now={now}
                variant="board"
                testIdPrefix="agent-run"
                listTestId="agent-run-rows"
                tokenLabel={tokenLabel}
                conflicts={conflicts}
              />
              <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 text-[11px] text-muted-foreground">
                <span
                  data-testid="agent-runs-total"
                  data-total={runs.total}
                  data-has-more={runs.hasMore ? "true" : "false"}
                >
                  {runs.hasMore
                    ? t("agents.runs.totalMore", { count: runs.total })
                    : t("agents.runs.shown", { count: runs.total })}
                </span>
                {runs.hasMore ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="agent-runs-more"
                    disabled={runs.loadingMore}
                    onClick={() => void runs.loadMore()}
                    className="max-md:min-h-11"
                  >
                    {runs.loadingMore ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    {t("agentControl.runs.loadMore")}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            mobileDetailOpen ? "flex" : "hidden md:flex",
          )}
        >
          {selected === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
                <History className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <p className="text-[13px] font-semibold text-foreground">
                {t("agents.runs.selectTitle")}
              </p>
              <p className="max-w-[30ch] text-[11px] leading-[1.5] text-muted-foreground">
                {t("agents.runs.selectBody")}
              </p>
            </div>
          ) : (
            <RunDetail
              boardId={selected.boardId}
              runId={selected.id}
              role={role}
              boardTitle={board?.title ?? selected.boardId}
              board={board}
              variant="board"
              tokenLabel={tokenLabel}
              sessionLabel={sessionLabel}
              onClose={() => setMobileDetailOpen(false)}
              onChanged={() => runs.reload()}
              onPreview={noteConflicts}
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] leading-[1.45] text-muted-foreground">
        <Info className="h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {role === "ADMIN"
            ? t("agents.runs.footerAdmin")
            : t("agents.runs.footerMember")}
        </span>
        {board === undefined ? null : (
          <Link
            to={`${routes.agents}?${new URLSearchParams({
              section: "runs",
              board: board.id,
            }).toString()}`}
            data-testid="agent-runs-open-all"
            className="inline-flex min-h-11 items-center gap-1 rounded-[5px] border border-border bg-surface/58 px-2 text-[11px] text-foreground hover:bg-hover md:min-h-7"
          >
            {t("agents.runs.openAll")} ↗
          </Link>
        )}
      </div>
    </div>
  );
}

function shortId(id: string, length = 8): string {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}
