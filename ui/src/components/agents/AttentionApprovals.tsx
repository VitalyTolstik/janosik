import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { ApprovalRequestDto } from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import {
  ApprovalCancelButton,
  ApprovalDecisionForm,
  ApprovalDetailError,
  ApprovalHash,
  ApprovalLinks,
  ApprovalMetaRow,
  ApprovalPlanBlock,
  ApprovalRiskBadge,
  ApprovalStatusBadge,
} from "@/components/approvals/approval-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  APPROVAL_KIND_KEYS,
  APPROVAL_STATUS_KEYS,
  effectiveApprovalStatus,
} from "@/utils/approval";
import { shortId } from "./agent-model";

export type AttentionApprovalFilter = "needs" | "decided" | "all";

export interface AttentionApprovalRow extends ApprovalRequestDto {
  boardTitle: string;
}

type Translate = ReturnType<typeof useI18n>["t"];

function decisionError(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  const code =
    error instanceof ApiError &&
    error.body !== null &&
    typeof error.body === "object"
      ? (error.body as { code?: unknown }).code
      : undefined;
  switch (code) {
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

function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function AttentionApprovalList({
  rows,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onChanged,
  now,
}: {
  rows: readonly AttentionApprovalRow[];
  filter: AttentionApprovalFilter;
  onFilterChange: (filter: AttentionApprovalFilter) => void;
  selectedId: string | null;
  onSelect: (row: AttentionApprovalRow) => void;
  onChanged: () => void;
  now: number;
}) {
  const { t, lang } = useI18n();
  const [rejecting, setRejecting] = useState<AttentionApprovalRow | null>(null);
  const counts = useMemo(() => {
    let needs = 0;
    for (const row of rows) {
      if (
        effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending"
      ) {
        needs += 1;
      }
    }
    return { needs, decided: rows.length - needs, all: rows.length };
  }, [now, rows]);
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const pending =
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending";
        if (filter === "needs") return pending;
        if (filter === "decided") return !pending;
        return true;
      }),
    [filter, now, rows],
  );

  if (rows.length === 0) return null;

  return (
    <section data-testid="agents-approvals">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold">{t("agents.approvals.title")}</h3>
        <div
          role="group"
          aria-label={t("agents.approvals.filterLabel")}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1"
        >
          {(
            [
              ["needs", "agents.approvals.needs", "needs"],
              ["decided", "agents.approvals.decided", "decided"],
              ["all", "agents.approvals.all", "all"],
            ] as const
          ).map(([value, key, countKey]) => (
            <button
              key={value}
              type="button"
              data-testid={`agents-approvals-filter-${value}`}
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                filter === value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {t(key)}
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {counts[countKey]}
              </span>
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success/70" aria-hidden />
          {filter === "needs"
            ? t("agents.approvals.emptyNeeds")
            : t("agents.approvals.emptyDecided")}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="agents-approval-list">
          {filtered.map((row) => {
            const effective = effectiveApprovalStatus(
              row.status,
              row.expiresAt,
              now,
            );
            return (
              <li key={row.id}>
                <article
                  data-status={effective}
                  className={cn(
                    "relative overflow-hidden rounded-lg border bg-surface/60 transition-colors",
                    selectedId === row.id
                      ? "border-warning/40 bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))]"
                      : "border-border hover:bg-surface/80",
                    effective === "pending" &&
                      "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-warning",
                  )}
                >
                  <button
                    type="button"
                    data-testid={`agents-approval-${row.id}`}
                    aria-current={selectedId === row.id}
                    onClick={() => onSelect(row)}
                    className="flex w-full flex-col gap-1.5 px-3 pt-2.5 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      <span className="font-[650] uppercase tracking-[0.06em] text-warning">
                        {t("agents.approvals.eyebrow")}
                      </span>
                      <span>·</span>
                      <span>{row.boardTitle}</span>
                      <span>·</span>
                      <span>{formatRelative(row.expiresAt, lang, now)}</span>
                      <ApprovalRiskBadge risk={row.risk} />
                      <ApprovalStatusBadge
                        status={effective}
                        testId="agents-approval-status"
                      />
                    </span>
                    <span className="text-[13px] font-semibold leading-5">
                      {row.summary}
                    </span>
                    <span className="text-[11px] leading-5 text-muted-foreground">
                      {t("agents.approvals.action", {
                        action: row.actionType,
                      })}{" "}
                      · {t(APPROVAL_KIND_KEYS[row.kind])}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1">
                    <Button
                      size="sm"
                      onClick={() => onSelect(row)}
                      data-testid={`agents-approval-review-${row.id}`}
                    >
                      {t("agents.approvals.reviewPlan")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejecting(row)}
                      data-testid={`agents-approval-reject-${row.id}`}
                    >
                      {t("agents.approvals.reject")}
                    </Button>
                    <code className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                      {t("agents.approvals.hash", {
                        hash: row.planHash.slice(0, 14),
                      })}
                    </code>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      <QuickRejectDialog
        row={rejecting}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        onRejected={onChanged}
      />
    </section>
  );
}

function QuickRejectDialog({
  row,
  onOpenChange,
  onRejected,
}: {
  row: AttentionApprovalRow | null;
  onOpenChange: (open: boolean) => void;
  onRejected: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new row starts with an empty reason
    if (row !== null) setReason("");
  }, [row]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (row === null || reason.trim() === "" || busy) return;
    setBusy(true);
    try {
      await api.decideApproval(row.boardId, row.id, {
        decision: "reject",
        planHash: row.planHash,
        comment: reason.trim(),
      });
      onRejected();
      toast.success(t("agentControl.approvals.rejectedToast"));
      onOpenChange(false);
    } catch (error) {
      toast.error(decisionError(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <DialogContent data-testid="agents-approval-quick-reject-dialog">
        <DialogHeader>
          <DialogTitle>{t("agents.approvals.quickRejectTitle")}</DialogTitle>
          <DialogDescription>
            {t("agents.approvals.quickRejectDescription")}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="agents-approval-reject-reason"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("agentControl.approvals.rejectReasonLabel")}
            </label>
            <Textarea
              id="agents-approval-reject-reason"
              data-testid="agents-approval-reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={t("agentControl.approvals.rejectReasonPlaceholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              data-testid="agents-approval-reject-confirm"
              disabled={busy || reason.trim() === ""}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t("agents.approvals.rejectConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AttentionApprovalDetail({
  boardId,
  approvalId,
  boardTitle,
  onChanged,
  onBack,
}: {
  boardId: string;
  approvalId: string;
  boardTitle: string;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<ApprovalRequestDto | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the detail while the new request runs
    setError(false);
    setDetail(null);
    void api
      .getApproval(boardId, approvalId)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [approvalId, boardId, revision]);

  const effectiveStatus =
    detail === null
      ? undefined
      : effectiveApprovalStatus(detail.status, detail.expiresAt, now);
  const canDecide = effectiveStatus === "pending";
  const commandCount =
    detail === null
      ? 0
      : (detail.plan?.commands?.length ?? 0) +
        (detail.plan?.operations?.length ?? 0);

  const decide = async (
    decision: "approve" | "reject",
    comment: string,
  ): Promise<boolean> => {
    if (detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.decideApproval(boardId, detail.id, {
        decision,
        planHash: detail.planHash,
        ...(comment === "" ? {} : { comment }),
      });
      setDetail(updated);
      onChanged();
      toast.success(
        decision === "approve"
          ? t("agentControl.approvals.approvedToast")
          : t("agentControl.approvals.rejectedToast"),
      );
      return true;
    } catch (submitError) {
      toast.error(decisionError(submitError, t));
      setRevision((value) => value + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<boolean> => {
    if (detail === null) return false;
    setBusy(true);
    try {
      const updated = await api.cancelApproval(boardId, detail.id);
      setDetail(updated);
      onChanged();
      toast.success(t("agentControl.approvals.cancelledToast"));
      return true;
    } catch (submitError) {
      toast.error(
        submitError instanceof ApiError && submitError.offline
          ? t("agentControl.error.offline")
          : t("agentControl.approvals.cancelError"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="agents-approval-detail"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] text-muted-foreground hover:text-foreground min-[1061px]:hidden"
            >
              {t("agents.approvals.back")}
            </button>
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("agents.approvals.selected")}
          </p>
          {canDecide ? (
            <div className="ml-auto">
              <ApprovalCancelButton busy={busy} onCancel={cancel} />
            </div>
          ) : null}
        </div>
        <h2 className="mt-0.5 text-[13px] font-semibold">
          {detail?.summary ?? t("agents.approvals.loading")}
        </h2>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {boardTitle}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <ApprovalDetailError onRetry={() => setRevision((v) => v + 1)} />
        ) : detail === null ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton width={220} height={18} />
            <Skeleton width={140} height={12} />
            <Skeleton width="100%" height={80} />
          </div>
        ) : effectiveStatus === undefined ? null : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <ApprovalStatusBadge status={effectiveStatus} />
              <ApprovalRiskBadge risk={detail.risk} />
              <span className="text-[11px] text-muted-foreground">
                {t(APPROVAL_KIND_KEYS[detail.kind])}
              </span>
            </div>

            {effectiveStatus === "pending" ? (
              <p className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[11px] leading-5 text-warning">
                {t("agents.approvals.waiting", {
                  time: formatRelative(detail.expiresAt, lang, now),
                })}
              </p>
            ) : effectiveStatus === "expired" ? (
              <p className="rounded-md border border-border bg-muted px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                {t("agentControl.approvals.expiredHint")}
              </p>
            ) : effectiveStatus === "approved" ? (
              <p className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-[11px] leading-5 text-success">
                {t("agentControl.approvals.approvedHint")}
              </p>
            ) : effectiveStatus === "consumed" ? (
              <p className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 text-[11px] leading-5 text-primary">
                {t("agentControl.approvals.consumedHint")}
              </p>
            ) : null}

            <p className="text-[12px] leading-5">
              <b className="font-semibold">
                {shortId(detail.requestedByTokenId, 12)}
              </b>{" "}
              {t("agents.approvals.asksPrefix")}{" "}
              <code className="font-mono text-[11px]">{detail.actionType}</code>{" "}
              {t("agents.approvals.asksOn")}{" "}
              <b className="font-semibold">{boardTitle}</b>.{" "}
              {t("agents.approvals.asksSuffix")}
            </p>

            {detail.kind === "destructive" ? (
              <div className="rounded-md border border-danger/40 bg-danger/5 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {t("agents.approvals.destructiveTitle")}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {t("agents.approvals.destructiveBody")}
                </p>
              </div>
            ) : null}

            <section className="space-y-2">
              <h4 className="text-xs font-semibold">
                {t("agents.approvals.request")}
              </h4>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ApprovalMetaRow label={t("agentControl.approvals.board")}>
                  {boardTitle}
                </ApprovalMetaRow>
                <ApprovalMetaRow label={t("agents.approvals.requestedBy")}>
                  <code className="font-mono text-[10px]">
                    {shortId(detail.requestedBy, 16)}
                  </code>
                </ApprovalMetaRow>
                <ApprovalMetaRow label={t("agentControl.approvals.token")}>
                  <code className="font-mono text-[10px]">
                    {shortId(detail.requestedByTokenId, 16)}
                  </code>
                </ApprovalMetaRow>
                <ApprovalMetaRow label={t("agentControl.approvals.session")}>
                  {detail.agentSessionId ? (
                    <code className="font-mono text-[10px]">
                      {shortId(detail.agentSessionId, 16)}
                    </code>
                  ) : (
                    t("agentControl.approvals.noSession")
                  )}
                </ApprovalMetaRow>
                <ApprovalMetaRow label={t("agentControl.approvals.card")}>
                  {detail.cardId === null ? (
                    t("agentControl.approvals.noCard")
                  ) : (
                    <span data-testid="agents-approval-card">
                      {shortId(detail.cardId, 16)}
                    </span>
                  )}
                </ApprovalMetaRow>
                <ApprovalMetaRow label={t("agentControl.approvals.expires")}>
                  {formatDate(detail.expiresAt, lang)}
                </ApprovalMetaRow>
              </dl>
            </section>

            <div className="flex flex-wrap items-stretch gap-2">
              <div className="min-w-0 flex-1 rounded-md border bg-background/30 p-2">
                <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
                  {t("agents.approvals.knownTarget")}
                </span>
                <b className="block truncate text-[11px]">
                  {detail.cardId === null
                    ? boardTitle
                    : shortId(detail.cardId, 18)}
                </b>
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1 rounded-md border border-warning/30 bg-warning/5 p-2">
                <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
                  {t("agents.approvals.exactAction")}
                </span>
                <b className="block truncate text-[11px] text-warning">
                  {detail.actionType}
                </b>
              </div>
            </div>

            <ApprovalPlanBlock
              approval={detail}
              title={t("agents.approvals.whatWillChange")}
              countLabel={t("agents.approvals.commands", {
                count: commandCount,
              })}
            />
            <ApprovalHash
              hash={detail.planHash}
              title={t("agents.approvals.integrity")}
              badge={t("agents.approvals.exactHash")}
              hint={t("agents.approvals.hashHint")}
            />

            <section className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-semibold">
                {t("agents.approvals.decisionHistory")}
              </h4>
              <ol className="space-y-2 text-[11px] leading-5">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                  <div>
                    <b className="block text-foreground">
                      {t("agents.approvals.historyRequested", {
                        name: shortId(detail.requestedBy, 16),
                      })}
                    </b>
                    <span className="text-muted-foreground">
                      {formatDate(detail.createdAt, lang)} ·{" "}
                      {t(APPROVAL_KIND_KEYS[detail.kind])} · {detail.risk} risk
                    </span>
                  </div>
                </li>
                {effectiveStatus === "pending" ? (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <div>
                      <b className="block text-foreground">
                        {t("agents.approvals.historyWaiting")}
                      </b>
                      <span className="text-muted-foreground">
                        {t("agents.approvals.expires", {
                          time: formatRelative(detail.expiresAt, lang, now),
                        })}{" "}
                        · {t("agents.approvals.oneTime")}
                      </span>
                    </div>
                  </li>
                ) : (
                  <li className="flex gap-2">
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        effectiveStatus === "rejected"
                          ? "bg-danger"
                          : effectiveStatus === "expired"
                            ? "bg-warning"
                            : effectiveStatus === "consumed"
                              ? "bg-primary"
                              : "bg-success",
                      )}
                    />
                    <div>
                      <b className="block text-foreground">
                        {detail.decidedBy
                          ? t("agents.approvals.historyDecision", {
                              status: t(APPROVAL_STATUS_KEYS[effectiveStatus]),
                              name: shortId(detail.decidedBy, 16),
                            })
                          : t(APPROVAL_STATUS_KEYS[effectiveStatus])}
                      </b>
                      <span className="text-muted-foreground">
                        {detail.decidedAt === null
                          ? formatDate(detail.expiresAt, lang)
                          : formatDate(detail.decidedAt, lang)}
                        {detail.decisionComment
                          ? ` · “${detail.decisionComment}”`
                          : ""}
                      </span>
                    </div>
                  </li>
                )}
                {detail.consumedAt !== null ? (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <div>
                      <b className="block text-foreground">
                        {t("agents.approvals.historyApplied")}
                      </b>
                      <span className="text-muted-foreground">
                        {formatDate(detail.consumedAt, lang)}
                      </span>
                    </div>
                  </li>
                ) : null}
              </ol>
            </section>

            <section className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-semibold">
                {t("agents.approvals.related")}
              </h4>
              <ApprovalLinks approval={detail} />
              <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
                {t("agentControl.approvals.token")}:{" "}
                <code className="font-mono text-[10px]">
                  {shortId(detail.requestedByTokenId, 16)}
                </code>
              </span>
            </section>

            <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">
                {t("agents.approvals.technicalDetails")}
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                {JSON.stringify(detail.plan ?? null, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
      {detail !== null && effectiveStatus !== undefined ? (
        <footer className="shrink-0 border-t border-border px-4 py-3">
          {canDecide ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                  aria-hidden
                />
                <p>
                  {t("agents.approvals.footerBefore")}{" "}
                  <b className="font-semibold text-foreground">
                    {t("agents.approvals.footerHash")}
                  </b>
                  {t("agents.approvals.footerAfter")}
                </p>
              </div>
              <ApprovalDecisionForm
                key={detail.id}
                busy={busy}
                onDecide={decide}
              />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {effectiveStatus === "expired"
                ? t("agentControl.approvals.expiredHint")
                : t("agentControl.approvals.readOnly")}
            </p>
          )}
        </footer>
      ) : null}
    </div>
  );
}
