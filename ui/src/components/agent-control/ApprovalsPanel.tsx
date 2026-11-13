import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Info,
  RefreshCw,
} from "lucide-react";
import type { ApprovalRequestDto, BoardRole } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import {
  ApprovalCancelButton,
  ApprovalDecisionForm,
  ApprovalDetailError,
  ApprovalHash,
  ApprovalLinks,
  ApprovalMetaRow as MetaRow,
  ApprovalPlanBlock,
  ApprovalRiskBadge,
  ApprovalStatusBadge,
} from "@/components/approvals/approval-ui";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { APPROVAL_KIND_KEYS, effectiveApprovalStatus } from "@/utils/approval";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";

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
type Decision = "approve" | "reject";
type Translate = ReturnType<typeof useI18n>["t"];

function errorCodeOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function decisionError(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  switch (errorCodeOf(error)) {
    case "approval_expired":
      return t("agentControl.error.expired");
    case "approval_not_pending":
      return t("agentControl.error.notPending");
    case "approval_mismatch":
      return t("agentControl.error.mismatch");
    case "approval_owner_mismatch":
      return t("agentControl.error.ownerMismatch");
    case "pat_forbidden":
      return t("agentControl.error.sessionOnly");
    default:
      break;
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

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
  role,
  onChanged,
}: {
  role: BoardRole | undefined;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const live = useBoardLive();
  const [filter, setFilter] = useState<ApprovalFilter>("needs");
  const [rows, setRows] = useState<ApprovalRequestDto[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ApprovalRequestDto | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const boardId = board?.id;
  const admin = role === "ADMIN";

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

  useEffect(() => {
    if (boardId === undefined || selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing selection is the effect's purpose
      setDetail(null);
      setDetailError(false);
      return;
    }
    let alive = true;
    setDetailError(false);
    setDetail((current) => (current?.id === selectedId ? current : null));
    void api
      .getApproval(boardId, selectedId)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {
        if (alive) setDetailError(true);
      });
    return () => {
      alive = false;
    };
  }, [boardId, selectedId, revision]);

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
  const filtered = useMemo(
    () =>
      queue.filter((row) => {
        const pending =
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending";
        if (filter === "needs") return pending;
        if (filter === "decided") return !pending;
        return true;
      }),
    [filter, now, queue],
  );
  const loadingList = rows === null && !listError;
  const effectiveStatus =
    detail === null
      ? undefined
      : effectiveApprovalStatus(detail.status, detail.expiresAt, now);
  const canDecide = admin && detail !== null && effectiveStatus === "pending";
  const canCancel = admin && detail !== null && effectiveStatus === "pending";

  const decide = async (
    decision: Decision,
    comment: string,
  ): Promise<boolean> => {
    if (boardId === undefined || detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.decideApproval(boardId, detail.id, {
        decision,
        planHash: detail.planHash,
        ...(comment === "" ? {} : { comment }),
      });
      setDetail(updated);
      // Keep the decided request visible instead of orphaning the detail.
      setFilter("all");
      setRevision((value) => value + 1);
      toast.success(
        decision === "approve"
          ? t("agentControl.approvals.approvedToast")
          : t("agentControl.approvals.rejectedToast"),
      );
      onChanged?.();
      return true;
    } catch (error) {
      toast.error(decisionError(error, t));
      setRevision((value) => value + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<boolean> => {
    if (boardId === undefined || detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.cancelApproval(boardId, detail.id);
      setDetail(updated);
      setFilter("all");
      setRevision((value) => value + 1);
      toast.success(t("agentControl.approvals.cancelledToast"));
      onChanged?.();
      return true;
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.offline
          ? t("agentControl.error.offline")
          : t("agentControl.approvals.cancelError"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cardFor = (cardId: string | null) =>
    cardId === null ? undefined : board?.cards[cardId];

  const boardMemberName = (userId: string): string => {
    const member = live.members.get(boardId, userId);
    return member?.displayName ?? member?.email ?? userId;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h3 className="mr-1 hidden text-[11.5px] font-[650] md:block">
          {t("agents.approvals.title")}
        </h3>
        <div
          role="group"
          aria-label={t("agentControl.approvals.filterLabel")}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1"
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
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors min-h-11 md:min-h-0",
                filter === value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {t(key)}
              {rows !== null ? (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
                  {counts[countKey]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground max-md:hidden">
          {t("agentControl.approvals.decideHint")}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(15rem,19rem)_1fr]">
        <div
          className={cn(
            "min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r",
            mobileDetailOpen && "max-md:hidden",
          )}
        >
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
            <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 text-success/70" aria-hidden />
              <p>
                {filter === "needs"
                  ? t("agentControl.approvals.emptyPending")
                  : filter === "decided"
                    ? t("agentControl.approvals.emptyDecided")
                    : t("agentControl.approvals.emptyAll")}
              </p>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <ul data-testid="approval-queue" className="divide-y">
              {filtered.map((row) => {
                const card = cardFor(row.cardId);
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

        <div
          className={cn(
            "flex min-h-0 flex-col",
            !mobileDetailOpen && "max-md:hidden",
          )}
          data-testid="approval-detail"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {detailError ? (
              <ApprovalDetailError onRetry={() => setRevision((v) => v + 1)} />
            ) : null}

            {!detailError && selectedId !== null && detail === null ? (
              <div className="space-y-3" aria-hidden="true">
                <Skeleton width={220} height={18} />
                <Skeleton width={140} height={12} />
                <Skeleton width="100%" height={80} />
              </div>
            ) : null}

            {!detailError &&
            detail !== null &&
            effectiveStatus !== undefined ? (
              <div className="space-y-4">
                <header className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setMobileDetailOpen(false)}
                    data-testid="approval-detail-back"
                    className="mb-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-[11px] font-medium text-muted-foreground hover:text-foreground md:hidden"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    {t("agents.approvals.back")}
                  </button>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-semibold">
                        {detail.summary}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {t(APPROVAL_KIND_KEYS[detail.kind])} ·{" "}
                        {detail.actionType}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ApprovalRiskBadge risk={detail.risk} />
                      <ApprovalStatusBadge status={effectiveStatus} />
                    </div>
                  </div>
                  {!admin ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-[color:var(--agent-tone-warning)]">
                      {t("agentControl.approvals.readOnly")}
                    </p>
                  ) : null}
                  {detail.status === "approved" ? (
                    <p className="rounded-md border border-success/30 bg-success/10 px-2 py-1.5 text-[11px] text-[color:var(--agent-tone-success)]">
                      {t("agentControl.approvals.approvedHint")}
                    </p>
                  ) : null}
                  {detail.status === "consumed" ? (
                    <p className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] text-primary">
                      {t("agentControl.approvals.consumedHint")}
                    </p>
                  ) : null}
                  {detail.status === "pending" &&
                  effectiveStatus === "expired" ? (
                    <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                      {t("agentControl.approvals.expiredHint")}
                    </p>
                  ) : null}
                </header>

                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MetaRow label={t("agentControl.approvals.requestedBy")}>
                    <span data-testid="approval-requested-by">
                      {boardMemberName(detail.requestedBy)}
                    </span>
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.board")}>
                    {board?.title ?? detail.boardId}
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.token")}>
                    <code className="font-mono text-[11px]">
                      {detail.requestedByTokenId}
                    </code>
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.session")}>
                    {detail.agentSessionId ? (
                      <code className="font-mono text-[11px]">
                        {detail.agentSessionId}
                      </code>
                    ) : (
                      t("agentControl.approvals.noSession")
                    )}
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.card")}>
                    {detail.cardId === null ? (
                      t("agentControl.approvals.noCard")
                    ) : (
                      <span data-testid="approval-card">
                        {cardFor(detail.cardId)?.title ?? detail.cardId}
                      </span>
                    )}
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.expires")}>
                    <span data-testid="approval-expiry">
                      {formatDate(detail.expiresAt, lang)} (
                      {formatRelative(detail.expiresAt, lang, now)})
                    </span>
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.created")}>
                    {formatDate(detail.createdAt, lang)}
                  </MetaRow>
                  <MetaRow label={t("agentControl.approvals.decidedBy")}>
                    {detail.decidedBy === null
                      ? t("agentControl.approvals.notDecided")
                      : boardMemberName(detail.decidedBy)}
                  </MetaRow>
                  {detail.decidedAt !== null ? (
                    <MetaRow label={t("agentControl.approvals.decidedAt")}>
                      {formatDate(detail.decidedAt, lang)}
                    </MetaRow>
                  ) : null}
                  {detail.consumedAt !== null ? (
                    <MetaRow label={t("agentControl.approvals.consumedAt")}>
                      {formatDate(detail.consumedAt, lang)}
                    </MetaRow>
                  ) : null}
                </dl>

                <ApprovalLinks approval={detail} />

                {detail.decisionComment !== null ? (
                  <div
                    className="space-y-1"
                    data-testid="approval-comment-view"
                  >
                    <h4 className="text-xs font-semibold">
                      {t("agentControl.approvals.comment")}
                    </h4>
                    <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                      {detail.decisionComment}
                    </p>
                  </div>
                ) : null}

                <ApprovalPlanBlock approval={detail} />
                <ApprovalHash hash={detail.planHash} />
              </div>
            ) : null}

            {!detailError &&
            selectedId === null &&
            !loadingList &&
            filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                <ClipboardList className="h-6 w-6 opacity-60" aria-hidden />
                <p>{t("agentControl.approvals.selectHint")}</p>
              </div>
            ) : null}
          </div>
          {canDecide && detail !== null ? (
            <div className="shrink-0 border-t border-border bg-popover px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalDecisionForm
                  key={detail.id}
                  busy={busy}
                  planHash={detail.planHash}
                  impactTitle={
                    detail.kind === "destructive"
                      ? t("agents.approvals.destructiveTitle")
                      : undefined
                  }
                  impactText={detail.summary}
                  onDecide={decide}
                />
                <ApprovalCancelButton
                  busy={busy}
                  onCancel={cancel}
                  disabled={!canCancel}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {!mobileDetailOpen ? (
        <div className="shrink-0 border-t border-border bg-popover px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-muted-foreground md:hidden">
          <span className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("agentControl.approvals.selectHint")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
