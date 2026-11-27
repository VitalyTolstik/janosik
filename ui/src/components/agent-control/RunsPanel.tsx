import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, History, Info, Loader2, RefreshCw } from "lucide-react";
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
} from "../agents/run-model";
import { RunDetail, RunList } from "../agents/run-ui";
import { useAgentRuns } from "../agents/use-agent-runs";
import { useRunConflictPreviews } from "../agents/use-run-conflict-previews";
import { AgentControlError } from "./AgentControlError";

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
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => {
    // Filtering starts a fresh page of five, like the mockup's board history.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the visible page on filter change
    setVisibleCount(5);
  }, [filter]);
  const visibleRows = useMemo(
    () => runs.rows.slice(0, visibleCount),
    [runs.rows, visibleCount],
  );
  const displayedConflicts = useRunConflictPreviews(
    visibleRows,
    true,
    runs.revision,
  );
  const shown = visibleRows.length;
  const total = runs.rows.length;
  const canLoadMore = shown < total || runs.hasMore;
  const loadMore = async () => {
    if (shown < total) {
      setVisibleCount((value) => value + 5);
      return;
    }
    await runs.loadMore();
    setVisibleCount((value) => value + 5);
  };
  const options = useMemo(() => runFilterOptions(t), [t]);
  const tokenNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const token of tokens) names.set(token.id, token.name);
    for (const run of runs.rows) {
      if (run.apiTokenId === null || run.tokenName == null) continue;
      names.set(run.apiTokenId, run.tokenName);
    }
    for (const session of sessions) {
      if (names.has(session.apiTokenId)) continue;
      names.set(
        session.apiTokenId,
        session.tokenName ??
          session.clientName ??
          session.name ??
          shortTokenId(session.apiTokenId),
      );
    }
    return names;
  }, [runs.rows, sessions, tokens]);
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
      : (tokenNames.get(tokenId) ?? shortTokenId(tokenId));
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
        ? [{ value: filter.token, label: shortTokenId(filter.token) }]
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
  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-ui-body text-muted-foreground">
        {t("agentControl.runs.offline")}
      </p>
    );
  }

  const foot = (
    <footer className="ac-foot">
      <span className="ac-foot-note">
        <Info className="icon" aria-hidden="true" />
        {role === "ADMIN"
          ? t("agentControl.runs.footerAdmin")
          : t("agentControl.runs.footerMember")}
      </span>
      <div className="ac-foot-actions">
        {board === undefined ? null : (
          <Link
            to={`${routes.agents}?${new URLSearchParams({
              section: "runs",
              board: board.id,
            }).toString()}`}
            data-testid="agent-runs-open-all"
            className="btn btn-outline btn-sm"
          >
            {t("agents.runs.openAll")}
            <ArrowUpRight className="icon" aria-hidden="true" />
          </Link>
        )}
      </div>
    </footer>
  );

  const noRunsAtAll =
    !runs.loading &&
    !runs.error &&
    runs.rows.length === 0 &&
    !hasRunFilter(filter);

  if (noRunsAtAll) {
    return (
      <div
        className="flex h-full min-h-0 flex-col"
        data-testid="agent-runs-panel"
      >
        <div className="ac-toolbar">
          <h3>{t("agents.shell.runs")}</h3>
          <span className="meta">{t("agentControl.runs.emptyMeta")}</span>
        </div>
        <div className="ac-panel-scroll">
          <div className="empty-state" data-testid="agent-runs-empty">
            <span className="empty-icon">
              <History className="icon" aria-hidden="true" />
            </span>
            <h3>{t("agentControl.runs.emptyTitle")}</h3>
            <p>{t("agentControl.runs.emptyBody")}</p>
          </div>
        </div>
        {foot}
      </div>
    );
  }

  if (!runs.loading && runs.error && runs.rows.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-col"
        data-testid="agent-runs-panel"
      >
        <div className="ac-toolbar">
          <h3>{t("agents.shell.runs")}</h3>
          <span className="meta">—</span>
        </div>
        <div className="ac-panel-scroll">
          <AgentControlError
            title={t("agentControl.runs.loadError")}
            body={t("agentControl.runs.loadErrorBody")}
            onRetry={runs.reload}
            testId="agent-runs-error"
            retryTestId="agent-runs-retry"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-runs-panel"
    >
      <div className="ac-toolbar">
        <h3>{t("agents.shell.runs")}</h3>
        <span className="meta">
          {runs.loading
            ? t("agentControl.runs.loading")
            : runs.error
              ? "—"
              : t("agents.runs.boardHistoryOf", {
                  shown,
                  total,
                })}
        </span>
        <button
          type="button"
          onClick={runs.reload}
          disabled={runs.loading}
          aria-label={t("agents.runs.refresh")}
          data-testid="agent-runs-refresh"
          className="icon-btn-sm"
          style={{ marginLeft: "auto" }}
        >
          <RefreshCw
            className={cn("icon", runs.loading && "animate-spin")}
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
          className="h-11 w-auto min-w-[104px] text-ui-meta md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.kind}
          options={options.kind}
          onChange={(value) => patch({ kind: value as RunKindFilter })}
          ariaLabel={t("agentControl.runs.filter.kind")}
          testId="run-filter-kind"
          className="h-11 w-auto min-w-[96px] text-ui-meta md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.token}
          options={tokenOptions}
          onChange={(value) => patch({ token: value })}
          ariaLabel={t("agentControl.runs.filter.token")}
          testId="run-filter-token"
          className="h-11 w-auto min-w-[104px] max-w-[148px] text-ui-meta md:h-[26px] md:min-h-[26px]"
        />
        <SelectField
          value={filter.session}
          options={sessionOptions}
          onChange={(value) => patch({ session: value })}
          ariaLabel={t("agentControl.runs.filter.session")}
          testId="run-filter-session"
          className="h-11 w-auto min-w-[104px] max-w-[148px] text-ui-meta md:h-[26px] md:min-h-[26px]"
        />
        <button
          type="button"
          onClick={clearFilters}
          data-testid="agent-runs-clear-filters"
          className="inline-flex min-h-11 items-center rounded-md px-2 text-ui-meta font-medium text-muted-foreground hover:bg-hover hover:text-foreground md:min-h-[26px]"
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
              <p className="text-ui-body text-[color:var(--agent-tone-danger)]">
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
                <p className="text-ui-body font-medium text-foreground">
                  {t("agents.runs.noMatch")}
                </p>
                <p className="max-w-[32ch] text-ui-body leading-[1.5] text-muted-foreground">
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
                <p className="text-ui-body font-medium text-foreground">
                  {t("agentControl.runs.empty")}
                </p>
                <p className="max-w-[32ch] text-ui-body leading-[1.5] text-muted-foreground">
                  {t("agents.runs.emptyBody")}
                </p>
              </div>
            )
          ) : (
            <>
              {runs.error ? (
                <div
                  role="alert"
                  className="m-2 flex flex-wrap items-center gap-2 rounded-[7px] border border-warning/35 bg-warning/6 px-2.5 py-2 text-ui-label text-foreground"
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
                rows={visibleRows}
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
                conflicts={displayedConflicts}
                groupMode="day"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 py-2.5 text-ui-meta text-muted-foreground">
                <span
                  data-testid="agent-runs-total"
                  data-shown={shown}
                  data-total={total}
                  data-has-more={canLoadMore ? "true" : "false"}
                >
                  {t("agents.runs.shownOf", { shown, total })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="agent-runs-more"
                  disabled={runs.loadingMore || !canLoadMore}
                  onClick={() => void loadMore()}
                  className="h-6 min-h-0 rounded-[5px] px-[7px] text-ui-meta font-[650] leading-none max-md:h-11 max-md:min-h-11"
                >
                  {runs.loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {t("agentControl.runs.loadMore")}
                </Button>
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
              <p className="text-ui-heading font-semibold text-foreground">
                {t("agents.runs.selectTitle")}
              </p>
              <p className="max-w-[30ch] text-ui-body leading-[1.5] text-muted-foreground">
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
            />
          )}
        </div>
      </div>

      {foot}
    </div>
  );
}

function shortId(id: string, length = 8): string {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

/** Token metadata keeps both ends: `cmwc7a7y…pz4qe6`, never a 12-char head. */
function shortTokenId(id: string): string {
  return id.length > 15 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}
