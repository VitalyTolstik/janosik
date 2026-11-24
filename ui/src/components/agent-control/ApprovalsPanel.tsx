import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Inbox, RefreshCw, Search } from "lucide-react";
import type {
  AgentSessionDto,
  ApprovalRequestDto,
  UserTokenDto,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  effectiveApprovalStatus,
  formatApprovalMoment,
} from "@/utils/approval";
import { useBoardState } from "@/store/BoardContext";
import { ApprovalStatusBadge } from "@/components/approvals/approval-ui";
import { AttentionApprovalDetail } from "@/components/agents/AttentionApprovals";
import { shortTokenId } from "@/components/agents/agent-model";
import { AgentControlFooterPortal } from "@/components/agents/AgentControlFooterPortal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AgentControlError } from "./AgentControlError";
import type { BoardApprovalQueue } from "./use-board-approval-queue";

/**
 * The approval queue of one board (TASK-166.14, TASK-179.3).
 *
 * A request is created by an agent token and authorizes one exact plan hash.
 * This panel is the human side: it shows the queue and the full plan, then
 * sends approve/reject/cancel with the hash the server requires. It never
 * applies a plan — the agent repeats the same command with `X-Approval-Id`.
 *
 * The component is mounted only while the dialog is open, so drafts reset by
 * remount (AGENT.md). Approval events refresh the list and detail in place.
 */

type ApprovalFilter = "needs" | "decided" | "all";

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function QueueSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("agentControl.approvals.loading")}
      testId="approval-queue-skeleton"
    >
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-2 rounded-lg border p-2.5">
            <Skeleton width="74%" height={12} />
            <Skeleton width="58%" height={10} />
            <div className="flex items-center gap-1.5">
              <Skeleton width={58} height={20} className="rounded-[5px]" />
              <Skeleton width={72} height={10} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function ApprovalsPanel({
  queueState,
}: {
  queueState: BoardApprovalQueue;
}) {
  const { t, lang } = useI18n();
  const { board } = useBoardState();
  const [params, setParams] = useSearchParams();
  const mobile = useMediaQuery("(max-width: 760px)");
  const [filter, setFilter] = useState<ApprovalFilter>("needs");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    params.get("approval"),
  );
  // A deep link is the whole point of the mobile sheet: opening it must show
  // the approval detail, not the list with a hidden selection.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    () => params.get("approval") !== null,
  );
  const [tokens, setTokens] = useState<UserTokenDto[]>([]);
  const [sessions, setSessions] = useState<AgentSessionDto[]>([]);
  const now = useNow();
  const boardId = board?.id;

  const { current, reload, loadMore } = queueState;
  const pending = current?.pending;
  const decided = current?.decided;
  const listError =
    current !== null &&
    (filter === "needs"
      ? pending === undefined && current.pendingError
      : filter === "decided"
        ? decided === undefined && current.decidedError
        : pending === undefined &&
          decided === undefined &&
          current.pendingError &&
          current.decidedError);
  const partialError =
    current !== null &&
    !listError &&
    ((filter !== "decided" && current.pendingError) ||
      (filter !== "needs" && current.decidedError));
  const moreStatus =
    filter !== "decided" && pending?.nextCursor
      ? "pending"
      : filter !== "needs" && decided?.nextCursor
        ? "decided"
        : null;

  useEffect(() => {
    if (boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    void Promise.all([
      api.listTokens().catch(() => [] as UserTokenDto[]),
      api.listAgentSessions(boardId).catch(() => [] as AgentSessionDto[]),
    ]).then(([nextTokens, nextSessions]) => {
      if (!alive) return;
      setTokens(nextTokens);
      setSessions(nextSessions);
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  const agentNameFor = (row: ApprovalRequestDto): string => {
    const token = tokens.find((entry) => entry.id === row.requestedByTokenId);
    if (token !== undefined) return token.name;
    const session = sessions.find(
      (entry) =>
        entry.id === row.agentSessionId ||
        entry.apiTokenId === row.requestedByTokenId,
    );
    return (
      session?.tokenName ??
      session?.name ??
      session?.clientName ??
      shortTokenId(row.requestedByTokenId)
    );
  };

  const queue = useMemo(() => {
    const merged = new Map<string, ApprovalRequestDto>();
    for (const row of pending?.items ?? []) merged.set(row.id, row);
    for (const row of decided?.items ?? []) {
      if (!merged.has(row.id)) merged.set(row.id, row);
    }
    return [...merged.values()];
  }, [pending, decided]);
  const selectedRow =
    selectedId === null
      ? undefined
      : queue.find((row) => row.id === selectedId);
  const counts = {
    needs: current?.pendingError ? null : (pending?.total ?? null),
    decided: current?.decidedError ? null : (decided?.total ?? null),
    all:
      current?.pendingError || current?.decidedError || !pending || !decided
        ? null
        : pending.total + decided.total,
  };
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queue.filter((row) => {
      const pending =
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending";
      if (filter === "needs" && !pending) return false;
      if (filter === "decided" && pending) return false;
      if (needle === "") return true;
      const card =
        row.cardId === null ? undefined : board?.cards[row.cardId]?.title;
      const haystack = [
        row.summary,
        row.requestedByTokenId,
        row.agentSessionId ?? "",
        row.cardId ?? "",
        card ?? "",
        row.kind,
        row.actionType,
        row.planHash,
        row.runId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [board?.cards, filter, now, queue, search]);
  const searchActive = search.trim() !== "";
  const requestedApprovalId = params.get("approval");
  useEffect(() => {
    // Keep the open detail when another actor decides the request. Filter
    // changes clear the selection in their handlers, and a deep link can
    // resolve directly even when its row is outside the loaded page.
    const next = requestedApprovalId ?? selectedId ?? filtered[0]?.id ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the URL or seed an empty selection
    if (next !== selectedId) setSelectedId(next);
  }, [filtered, requestedApprovalId, selectedId]);
  // Once the list has loaded, a null selection means the queue has no
  // visible row: close the mobile sheet so the user lands on the list/empty
  // state instead of a detail pane with no Back affordance.
  useEffect(() => {
    if (current === null || !mobile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the sheet once the loaded queue has no selectable row
    if (selectedId === null) setMobileDetailOpen(false);
  }, [current, mobile, selectedId]);
  const loadingList = current === null;
  const pendingRows = useMemo(
    () =>
      filtered.filter(
        (row) =>
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
      ),
    [filtered, now],
  );
  const decidedRows = useMemo(
    () =>
      filtered.filter(
        (row) =>
          effectiveApprovalStatus(row.status, row.expiresAt, now) !== "pending",
      ),
    [filtered, now],
  );
  if (listError) {
    return (
      <div
        className="flex h-full min-h-0 flex-col"
        data-testid="agent-approvals-panel"
      >
        <div className="ac-toolbar">
          <h3>{t("agents.approvals.title")}</h3>
        </div>
        <div className="ac-panel-scroll">
          <AgentControlError
            title={t("agentControl.approvals.loadError")}
            body={t("agentControl.approvals.loadErrorBody")}
            onRetry={() => void reload()}
            testId="agent-approvals-error-card"
            retryTestId="agent-approvals-retry"
          />
        </div>
      </div>
    );
  }

  const headLeft =
    filter === "needs"
      ? t("agentControl.approvals.listHeadNeeds")
      : filter === "decided"
        ? t("agentControl.approvals.listHeadDecided")
        : t("agents.approvals.title");
  const headRight =
    filter === "decided"
      ? t("agentControl.approvals.listHeadDecidedRight")
      : t("agentControl.approvals.listHeadExpires");

  const dropApprovalParam = () => {
    if (!params.has("approval")) return;
    const next = new URLSearchParams(params);
    next.delete("approval");
    setParams(next, { replace: true });
  };

  const changeFilter = (next: ApprovalFilter) => {
    setFilter(next);
    setSelectedId(null);
    dropApprovalParam();
  };

  const changeSearch = (next: string) => {
    setSearch(next);
    setSelectedId(null);
    dropApprovalParam();
  };

  const clearSearchAndFilter = () => {
    changeSearch("");
    changeFilter("needs");
  };

  const selectApproval = (id: string, openDetail = true) => {
    setSelectedId(id);
    setMobileDetailOpen(openDetail);
    const next = new URLSearchParams(params);
    next.set("approval", id);
    setParams(next, { replace: true });
  };

  const renderRow = (row: ApprovalRequestDto, pending: boolean) => {
    const card = row.cardId === null ? undefined : board?.cards[row.cardId];
    const effective = effectiveApprovalStatus(row.status, row.expiresAt, now);
    const agent = agentNameFor(row);
    return (
      <button
        key={row.id}
        type="button"
        data-testid={`approval-row-${row.id}`}
        data-status={effective}
        aria-current={selectedId === row.id}
        onClick={() => selectApproval(row.id)}
        className={cn(
          "block w-full border-b border-border-soft px-2.5 py-[9px] text-left transition-colors min-[761px]:py-2",
          pending && "bg-warning/3",
          selectedId === row.id
            ? pending
              ? "bg-warning/6 shadow-[inset_2px_0_0_var(--warning)]"
              : "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)]"
            : "hover:bg-hover/48",
        )}
      >
        <span className="line-clamp-2 block text-ui-body leading-[1.35] font-[650] text-foreground">
          {row.summary}
        </span>
        <span className="mt-0.5 block truncate text-ui-meta leading-[1.4] text-muted-foreground">
          {agent}
          {card ? ` · ${card.title}` : ""}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1 text-ui-meta text-muted-foreground">
          <ApprovalStatusBadge
            status={effective}
            testId="approval-row-status"
          />
          <span
            aria-hidden
            className="h-0.5 w-0.5 shrink-0 rounded-full bg-border"
          />
          <span>{t(`agentControl.risk.${row.risk}`)}</span>
          <span
            className={cn(
              "ml-auto whitespace-nowrap",
              pending ? "text-[color:var(--warning)]" : "text-muted-foreground",
            )}
          >
            {pending
              ? t("agents.approvals.expiresIn", {
                  count: Math.max(0, Math.ceil((row.expiresAt - now) / 60_000)),
                })
              : formatApprovalMoment(row.decidedAt ?? row.expiresAt, lang, t)}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ac-toolbar">
        <h3>{t("agents.approvals.title")}</h3>
        <div
          role="group"
          aria-hidden={loadingList || listError}
          className={cn("seg", (loadingList || listError) && "invisible")}
          aria-label={t("agentControl.approvals.filterLabel")}
        >
          {(
            [
              ["needs", "agentControl.approvals.filterNeeds", "needs"],
              ["decided", "agentControl.approvals.filterDecided", "decided"],
              ["all", "agentControl.approvals.filterAll", "all"],
            ] as const
          ).map(([value, key, countKey]) => (
            <button
              key={value}
              type="button"
              data-testid={`approval-filter-${value}`}
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
              className={cn("chip", filter === value && "primary")}
            >
              {t(key)}
              <b className="tabular-nums">{counts[countKey] ?? "—"}</b>
            </button>
          ))}
        </div>
        <div className="input-wrap ac-search">
          <Search className="icon" aria-hidden="true" />
          <input
            className="input"
            data-testid="approval-search"
            type="search"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder={t("agentControl.approvals.searchPlaceholder")}
            aria-label={t("agentControl.approvals.searchLabel")}
          />
        </div>
        <button
          type="button"
          className="icon-btn-sm"
          data-testid="approval-refresh"
          aria-label={t("agentControl.approvals.refresh")}
          onClick={() => void reload()}
        >
          <RefreshCw className="icon" aria-hidden="true" />
        </button>
      </div>

      <div
        data-testid="approval-split"
        className={cn(
          "ac-split",
          mobileDetailOpen && "is-detail-open",
          (loadingList || listError) && "!grid-cols-1",
        )}
      >
        <div
          className={cn(
            "ac-list",
            (loadingList || listError) && "!w-full !border-r-0",
          )}
        >
          <div className="ac-list-head">
            <span>{headLeft}</span>
            <span>{headRight}</span>
          </div>
          {loadingList ? (
            <div className="p-3">
              <QueueSkeleton />
            </div>
          ) : null}
          {partialError ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-2 p-6 text-center text-ui-body text-muted-foreground"
            >
              <p>{t("agentControl.approvals.loadError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void reload()}
                className="max-md:min-h-11"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.retry")}
              </Button>
            </div>
          ) : null}
          {!loadingList && !listError && filtered.length === 0 ? (
            <div
              className="empty-state"
              style={{ minHeight: 220 }}
              data-testid="approval-empty"
            >
              <span className="empty-icon">
                <Inbox className="icon" aria-hidden="true" />
              </span>
              <h3>
                {searchActive
                  ? t("agents.approvals.emptyFiltered")
                  : filter === "needs"
                    ? t("agentControl.approvals.emptyPending")
                    : t("agentControl.approvals.emptyOther")}
              </h3>
              <p>
                {searchActive
                  ? t("agents.approvals.emptyFilteredBody")
                  : filter === "needs"
                    ? t("agentControl.approvals.emptyPendingBody")
                    : t("agentControl.approvals.emptyOtherBody")}
              </p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm max-md:min-h-11"
                  onClick={() =>
                    searchActive ? clearSearchAndFilter() : changeFilter("all")
                  }
                >
                  {searchActive
                    ? t("agents.clearFilters")
                    : t("agentControl.approvals.viewAll")}
                </button>
              </div>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <div data-testid="approval-queue" className="pb-1">
              {pendingRows.length > 0 ? (
                <div>
                  <div className="flex items-center gap-1 px-2.5 pt-[7px] pb-1 text-ui-micro tracking-[0.06em] uppercase text-muted-foreground">
                    <span>{t("agentControl.approvals.listHeadNeeds")}</span>
                    <span className="ml-auto tabular-nums">
                      {counts.needs ?? "—"}
                    </span>
                  </div>
                  {pendingRows.map((row) => renderRow(row, true))}
                </div>
              ) : null}
              {decidedRows.length > 0 && filter !== "needs" ? (
                <div>
                  <div className="flex items-center gap-1 px-2.5 pt-[7px] pb-1 text-ui-micro tracking-[0.06em] uppercase text-muted-foreground">
                    <span>{t("agentControl.approvals.listHeadDecided")}</span>
                    <span className="ml-auto tabular-nums">
                      {counts.decided ?? "—"}
                    </span>
                  </div>
                  {decidedRows.map((row) => renderRow(row, false))}
                </div>
              ) : null}
            </div>
          ) : null}
          {moreStatus !== null ? (
            <div className="p-2 text-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="approval-load-more"
                disabled={current?.loadingMore !== undefined}
                onClick={() => void loadMore(moreStatus)}
              >
                {t("agentControl.runs.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>

        {!loadingList && !listError ? (
          <div className="ac-detail" data-testid="approval-detail">
            {selectedId === null || boardId === undefined ? (
              <div className="detail-empty" data-testid="approval-detail-empty">
                <span className="empty-icon">
                  <Inbox className="icon" aria-hidden="true" />
                </span>
                <h3>{t("agentControl.approvals.selectTitle")}</h3>
                <p>{t("agentControl.approvals.selectHint")}</p>
              </div>
            ) : (
              <AttentionApprovalDetail
                boardId={boardId}
                approvalId={selectedId}
                boardTitle={board?.title ?? boardId}
                variant="board"
                fallbackAgentName={
                  selectedRow === undefined
                    ? undefined
                    : agentNameFor(selectedRow)
                }
                footerActive={!mobile || mobileDetailOpen}
                focusBack={mobile && mobileDetailOpen}
                onBack={() => setMobileDetailOpen(false)}
                onChanged={() => {
                  if (selectedId !== null)
                    selectApproval(selectedId, mobileDetailOpen);
                  void reload();
                }}
              />
            )}
          </div>
        ) : null}
      </div>
      {!loadingList && !listError && filtered.length === 0 && !searchActive ? (
        <AgentControlFooterPortal>
          <footer className="ac-foot ac-foot-static">
            <span className="ac-foot-note">
              {t("agentControl.approvals.emptyFooter")}
            </span>
          </footer>
        </AgentControlFooterPortal>
      ) : null}
      {mobile && !mobileDetailOpen && filtered.length > 0 ? (
        <AgentControlFooterPortal>
          <footer className="ac-foot ac-foot-static">
            <span className="ac-foot-mobile-hint">
              {t("agentControl.approvals.mobileHint")}
            </span>
          </footer>
        </AgentControlFooterPortal>
      ) : null}
    </div>
  );
}
