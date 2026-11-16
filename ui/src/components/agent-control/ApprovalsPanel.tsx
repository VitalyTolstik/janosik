import { useEffect, useMemo, useState } from "react";
import { Inbox, RefreshCw, Search } from "lucide-react";
import type { ApprovalRequestDto, BoardRole } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { formatRelative, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { APPROVAL_KIND_KEYS, effectiveApprovalStatus } from "@/utils/approval";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";
import {
  ApprovalRiskBadge,
  ApprovalStatusBadge,
} from "@/components/approvals/approval-ui";
import { AttentionApprovalDetail } from "@/components/agents/AttentionApprovals";

/**
 * The approval queue of one board (TASK-166.14, TASK-179.3).
 *
 * A request is created by an agent token and authorizes one exact plan hash.
 * This panel is the human side: it shows the queue and the full plan, then
 * sends approve/reject/cancel with the hash the server requires. It never
 * applies a plan — the agent repeats the same command with `X-Approval-Id`.
 *
 * The component is mounted only while the dialog is open, so drafts reset by
 * remount (AGENT.md). SSE approval frames bump `revision`; list and detail
 * refetch in place without reloading the page.
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
          <div key={index} className="space-y-1.5 rounded-lg border p-3">
            <Skeleton width={140} height={12} />
            <Skeleton width={200} height={10} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function ApprovalsPanel({
  onChanged,
}: {
  role: BoardRole | undefined;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const { board } = useBoardState();
  const live = useBoardLive();
  const [filter, setFilter] = useState<ApprovalFilter>("needs");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ApprovalRequestDto[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const now = useNow();
  const boardId = board?.id;

  useEffect(
    () => live.agentControl.subscribeApproval(() => setRevision((v) => v + 1)),
    [live],
  );

  useEffect(() => {
    if (boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the request with a clean error state
    setListError(false);
    void api
      .listApprovals(boardId, { limit: 100 })
      .then((next) => {
        if (!alive) return;
        setRows(next);
        // Keep an explicitly selected approval even when the active filter no
        // longer lists it: a live decision from another tab must update the
        // open detail instead of closing it.
        setSelectedId((current) => current ?? next[0]?.id ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setListError(true);
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [boardId, revision]);

  const queue = useMemo(() => rows ?? [], [rows]);
  const counts = useMemo(() => {
    let needs = 0;
    for (const row of queue) {
      if (
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending"
      ) {
        needs += 1;
      }
    }
    return { needs, decided: queue.length - needs, all: queue.length };
  }, [now, queue]);
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
  const loadingList = rows === null && !listError;
  const nextPendingId = useMemo(() => {
    if (selectedId === null) return null;
    const pending = filtered.filter(
      (row) =>
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
    );
    if (pending.length < 2) return null;
    const index = pending.findIndex((row) => row.id === selectedId);
    return pending[(index + 1) % pending.length]?.id ?? null;
  }, [filtered, now, selectedId]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ac-toolbar">
        <h3>{t("agents.approvals.title")}</h3>
        <div
          role="group"
          aria-label={t("agentControl.approvals.filterLabel")}
          className="seg"
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
              onClick={() => setFilter(value)}
              className={cn("chip", filter === value && "primary")}
            >
              {t(key)}
              <b className="tabular-nums">{counts[countKey]}</b>
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("agentControl.approvals.searchPlaceholder")}
            aria-label={t("agentControl.approvals.searchLabel")}
          />
        </div>
        <button
          type="button"
          className="icon-btn-sm"
          data-testid="approval-refresh"
          aria-label={t("agentControl.approvals.refresh")}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className="icon" aria-hidden="true" />
        </button>
      </div>

      <div className={cn("ac-split", mobileDetailOpen && "is-detail-open")}>
        <div className="ac-list">
          <div className="ac-list-head">
            <span>{headLeft}</span>
            <span>{headRight}</span>
          </div>
          {loadingList ? (
            <div className="p-3">
              <QueueSkeleton />
            </div>
          ) : null}
          {listError ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <p>{t("agentControl.approvals.loadError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
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
                {filter === "needs"
                  ? t("agentControl.approvals.emptyPending")
                  : t("agentControl.approvals.emptyOther")}
              </h3>
              <p>
                {filter === "needs"
                  ? t("agentControl.approvals.emptyPendingBody")
                  : t("agentControl.approvals.emptyOtherBody")}
              </p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setFilter("all")}
                >
                  {t("agentControl.approvals.viewAll")}
                </button>
              </div>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <ul data-testid="approval-queue" className="divide-y">
              {filtered.map((row) => {
                const card =
                  row.cardId === null ? undefined : board?.cards[row.cardId];
                const effective = effectiveApprovalStatus(
                  row.status,
                  row.expiresAt,
                  now,
                );
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-testid={`approval-row-${row.id}`}
                      data-status={effective}
                      aria-current={selectedId === row.id}
                      onClick={() => {
                        setSelectedId(row.id);
                        setMobileDetailOpen(true);
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors",
                        selectedId === row.id
                          ? "bg-primary/10"
                          : "hover:bg-hover",
                      )}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium">
                          {row.summary}
                        </span>
                        <ApprovalStatusBadge
                          status={effective}
                          testId="approval-row-status"
                        />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <ApprovalRiskBadge
                          risk={row.risk}
                          testId="approval-row-risk"
                        />
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {t(APPROVAL_KIND_KEYS[row.kind])}
                        </span>
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {card
                          ? `#${card.title}`
                          : t("agentControl.approvals.boardOnly")}
                        {" · "}
                        {formatRelative(row.createdAt, lang, now)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

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
              onBack={() => setMobileDetailOpen(false)}
              onChanged={() => {
                setRevision((value) => value + 1);
                onChanged?.();
              }}
              onNextPending={
                nextPendingId === null
                  ? undefined
                  : () => setSelectedId(nextPendingId)
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
