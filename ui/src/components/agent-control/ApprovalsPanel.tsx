import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import type {
  ApprovalKind,
  ApprovalRequestDto,
  ApprovalRisk,
  ApprovalStatus,
} from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import type { BoardRole } from "@janosik/shared";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";

/**
 * The approval queue of one board (TASK-166.14).
 *
 * A request is created by an agent token and authorizes one exact plan hash.
 * This panel is the human side: it shows the queue and the full plan, then
 * sends approve/reject with the hash the server requires. It never applies a
 * plan — the agent repeats the same command with `X-Approval-Id`.
 *
 * The component is mounted only while the dialog is open, so drafts reset by
 * remount (AGENT.md). SSE approval frames bump `revision`; list and detail
 * refetch in place without reloading the page.
 */

type ApprovalFilter = "pending" | "all";
type Decision = "approve" | "reject";
type Translate = ReturnType<typeof useI18n>["t"];

const STATUS_KEYS: Record<ApprovalStatus, MessageKey> = {
  pending: "agentControl.status.pending",
  approved: "agentControl.status.approved",
  rejected: "agentControl.status.rejected",
  expired: "agentControl.status.expired",
  cancelled: "agentControl.status.cancelled",
  consumed: "agentControl.status.consumed",
};

const RISK_KEYS: Record<ApprovalRisk, MessageKey> = {
  low: "agentControl.risk.low",
  medium: "agentControl.risk.medium",
  high: "agentControl.risk.high",
};

const KIND_KEYS: Record<ApprovalKind, MessageKey> = {
  destructive: "agentControl.kind.destructive",
  done: "agentControl.kind.done",
  custom: "agentControl.kind.custom",
};

const STATUS_CLASS: Record<ApprovalStatus, string> = {
  pending: "border-warning/40 bg-warning/10 text-warning",
  approved: "border-success/40 bg-success/10 text-success",
  rejected: "border-danger/40 bg-danger/10 text-danger",
  expired: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
  consumed: "border-primary/40 bg-primary/10 text-primary",
};

const RISK_CLASS: Record<ApprovalRisk, string> = {
  low: "border-border bg-muted text-muted-foreground",
  medium: "border-warning/40 bg-warning/10 text-warning",
  high: "border-danger/40 bg-danger/10 text-danger",
};

function statusLabel(t: Translate, status: ApprovalStatus): string {
  return t(STATUS_KEYS[status]);
}

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

function planSummary(detail: ApprovalRequestDto): string {
  const commands = detail.plan?.commands?.length ?? 0;
  const operations = detail.plan?.operations?.length ?? 0;
  return commands + operations === 0
    ? detail.actionType
    : `${detail.actionType} · ${commands + operations}`;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function StatusBadge({
  status,
  testId = "approval-status",
}: {
  status: ApprovalStatus;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STATUS_CLASS[status],
      )}
    >
      {statusLabel(t, status)}
    </span>
  );
}

function RiskBadge({
  risk,
  testId = "approval-risk",
}: {
  risk: ApprovalRisk;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid={testId}
      data-risk={risk}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        RISK_CLASS[risk],
      )}
    >
      <ShieldAlert className="h-3 w-3" aria-hidden />
      {t(RISK_KEYS[risk])}
    </span>
  );
}

function MetaRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5" data-testid={testId}>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-xs">{children}</dd>
    </div>
  );
}

function DecisionForm({
  busy,
  onDecide,
}: {
  busy: boolean;
  onDecide: (decision: Decision, comment: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === null || submitting || busy) return;
    setSubmitting(true);
    try {
      const ok = await onDecide(mode, comment.trim());
      if (ok) {
        setMode(null);
        setComment("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="approval-approve"
          onClick={() => setMode("approve")}
          disabled={busy}
          className="bg-success text-white hover:bg-success/90"
        >
          <Check className="h-4 w-4" aria-hidden />
          {t("agentControl.approvals.approve")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="approval-reject"
          onClick={() => setMode("reject")}
          disabled={busy}
          className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
        >
          <X className="h-4 w-4" aria-hidden />
          {t("agentControl.approvals.reject")}
        </Button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-2">
      <p
        className={cn(
          "text-xs",
          mode === "approve" ? "text-success" : "text-danger",
        )}
        role="status"
        data-testid="approval-decision-hint"
      >
        {mode === "approve"
          ? t("agentControl.approvals.approveHint")
          : t("agentControl.approvals.rejectHint")}
      </p>
      <div className="space-y-1">
        <label
          htmlFor="approval-comment"
          className="text-xs font-medium text-muted-foreground"
        >
          {t("agentControl.approvals.commentLabel")}
        </label>
        <Textarea
          id="approval-comment"
          data-testid="approval-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t("agentControl.approvals.commentPlaceholder")}
          autoFocus
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="approval-confirm"
          disabled={submitting}
          className={cn(
            mode === "approve"
              ? "bg-success text-white hover:bg-success/90"
              : "bg-danger text-white hover:bg-danger/90",
          )}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : mode === "approve" ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <X className="h-4 w-4" aria-hidden />
          )}
          {mode === "approve"
            ? t("agentControl.approvals.confirmApprove")
            : t("agentControl.approvals.confirmReject")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setMode(null);
            setComment("");
          }}
          disabled={submitting}
        >
          {t("common.cancel")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t("agentControl.approvals.hashHint")}
        </span>
      </div>
    </form>
  );
}

function PlanBlock({ detail }: { detail: ApprovalRequestDto }) {
  const { t } = useI18n();
  const commands = detail.plan?.commands ?? [];
  const operations = detail.plan?.operations ?? [];
  return (
    <section className="space-y-2" data-testid="approval-plan">
      <h4 className="text-xs font-semibold">
        {t("agentControl.approvals.plan")}
      </h4>
      {commands.length === 0 && operations.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("agentControl.approvals.noPlan")}
        </p>
      ) : null}
      {commands.length > 0 ? (
        <ol className="space-y-1.5">
          {commands.map((command, index) => (
            <li
              key={command.commandId}
              data-testid="approval-plan-command"
              className="rounded-md border bg-muted/30 p-2"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium">
                <span className="rounded bg-background px-1 text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                {String(command.action.type)}
              </p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                {JSON.stringify(command.action, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      ) : null}
      {operations.length > 0 ? (
        <ol className="space-y-1.5">
          {operations.map((operation, index) => (
            <li
              key={`${operation.op}-${index}`}
              data-testid="approval-plan-operation"
              className="rounded-md border bg-muted/30 p-2"
            >
              <p className="text-[11px] font-medium">{operation.op}</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                {JSON.stringify(
                  { target: operation.target, body: operation.body },
                  null,
                  2,
                )}
              </pre>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
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
  const [filter, setFilter] = useState<ApprovalFilter>("pending");
  const [rows, setRows] = useState<ApprovalRequestDto[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    setListError(false);
    void api
      .listApprovals(boardId, filter === "pending" ? { status: "pending" } : {})
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
  }, [boardId, filter, revision]);

  useEffect(() => {
    if (boardId === undefined || selectedId === null) {
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
  const loadingList = rows === null && !listError;
  const effectiveStatus: ApprovalStatus | undefined =
    detail !== null && detail.status === "pending" && detail.expiresAt <= now
      ? "expired"
      : detail?.status;
  const canDecide =
    admin &&
    detail !== null &&
    detail.status === "pending" &&
    detail.expiresAt > now;

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
      // The pending filter would drop the row and close the detail the human
      // just decided; switch to All so the decision and its audit stay on
      // screen while the queue refreshes.
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

  const cardFor = (cardId: string | null) =>
    cardId === null ? undefined : board?.cards[cardId];

  const boardMemberName = (userId: string): string => {
    const member = live.members.get(boardId, userId);
    return member?.displayName ?? member?.email ?? userId;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div
          role="group"
          aria-label={t("agentControl.approvals.filterLabel")}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1"
        >
          {(
            [
              ["pending", "agentControl.approvals.filterPending"],
              ["all", "agentControl.approvals.filterAll"],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              data-testid={`approval-filter-${value}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {t(key)}
              {value === "pending" && rows !== null ? (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                  {rows.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t("agentControl.approvals.decideHint")}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(15rem,19rem)_1fr]">
        <div className="min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r">
          {loadingList ? (
            <div className="p-3">
              <QueueSkeleton />
            </div>
          ) : null}
          {listError ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
              <p>{t("agentControl.approvals.loadError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.retry")}
              </Button>
            </div>
          ) : null}
          {!loadingList && !listError && queue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 text-success/70" aria-hidden />
              <p>
                {filter === "pending"
                  ? t("agentControl.approvals.emptyPending")
                  : t("agentControl.approvals.emptyAll")}
              </p>
            </div>
          ) : null}
          {queue.length > 0 ? (
            <ul data-testid="approval-queue" className="divide-y">
              {queue.map((row) => {
                const card = cardFor(row.cardId);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-testid={`approval-row-${row.id}`}
                      data-status={row.status}
                      aria-current={selectedId === row.id}
                      onClick={() => setSelectedId(row.id)}
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
                        <StatusBadge
                          status={row.status}
                          testId="approval-row-status"
                        />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <RiskBadge risk={row.risk} testId="approval-row-risk" />
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t(KIND_KEYS[row.kind])}
                        </span>
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {card
                          ? `#${card.title}`
                          : t("agentControl.approvals.boardOnly")}
                        {" · "}
                        {formatRelative(row.createdAt, lang)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div
          className="min-h-0 overflow-y-auto p-4"
          data-testid="approval-detail"
        >
          {detailError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
              <p>{t("agentControl.approvals.detailError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.retry")}
              </Button>
            </div>
          ) : null}

          {!detailError && selectedId !== null && detail === null ? (
            <div className="space-y-3" aria-hidden="true">
              <Skeleton width={220} height={18} />
              <Skeleton width={140} height={12} />
              <Skeleton width="100%" height={80} />
            </div>
          ) : null}

          {!detailError && detail !== null && effectiveStatus !== undefined ? (
            <div className="space-y-4">
              <header className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-semibold">{detail.summary}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {t(KIND_KEYS[detail.kind])} · {planSummary(detail)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RiskBadge risk={detail.risk} />
                    <StatusBadge status={effectiveStatus} />
                  </div>
                </div>
                {!admin ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                    {t("agentControl.approvals.readOnly")}
                  </p>
                ) : null}
                {detail.status === "approved" ? (
                  <p className="rounded-md border border-success/30 bg-success/10 px-2 py-1.5 text-[11px] text-success">
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
                  <code className="font-mono text-[10px]">
                    {detail.requestedByTokenId}
                  </code>
                </MetaRow>
                <MetaRow label={t("agentControl.approvals.session")}>
                  {detail.agentSessionId ? (
                    <code className="font-mono text-[10px]">
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
                {detail.runId !== null ? (
                  <MetaRow label={t("agentControl.approvals.run")}>
                    <code className="font-mono text-[10px]">
                      {detail.runId}
                    </code>
                  </MetaRow>
                ) : null}
              </dl>

              {detail.decisionComment !== null ? (
                <div className="space-y-1" data-testid="approval-comment-view">
                  <h4 className="text-xs font-semibold">
                    {t("agentControl.approvals.comment")}
                  </h4>
                  <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                    {detail.decisionComment}
                  </p>
                </div>
              ) : null}

              <PlanBlock detail={detail} />

              <div className="space-y-1">
                <h4 className="text-xs font-semibold">
                  {t("agentControl.approvals.planHash")}
                </h4>
                <code
                  data-testid="approval-plan-hash"
                  className="block break-all rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground"
                >
                  {detail.planHash}
                </code>
              </div>

              {canDecide ? (
                <div className="border-t pt-3">
                  <DecisionForm key={detail.id} busy={busy} onDecide={decide} />
                </div>
              ) : null}
            </div>
          ) : null}

          {!detailError &&
          selectedId === null &&
          !loadingList &&
          queue.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <ClipboardList className="h-6 w-6 opacity-60" aria-hidden />
              <p>{t("agentControl.approvals.selectHint")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
