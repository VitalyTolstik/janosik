import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ApprovalRequestDto } from "@janosik/shared";

import { api, ApiError } from "@/api/client";
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
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { APPROVAL_KIND_KEYS, effectiveApprovalStatus } from "@/utils/approval";

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
  now,
}: {
  rows: readonly AttentionApprovalRow[];
  filter: AttentionApprovalFilter;
  onFilterChange: (filter: AttentionApprovalFilter) => void;
  selectedId: string | null;
  onSelect: (row: AttentionApprovalRow) => void;
  now: number;
}) {
  const { t, lang } = useI18n();
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
                <button
                  type="button"
                  data-testid={`agents-approval-${row.id}`}
                  data-status={effective}
                  aria-current={selectedId === row.id}
                  onClick={() => onSelect(row)}
                  className={cn(
                    "relative flex w-full flex-col gap-1.5 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selectedId === row.id
                      ? "border-warning/40 bg-warning/5"
                      : "border-border bg-card/50 hover:bg-hover",
                    effective === "pending" &&
                      "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-warning",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wide text-warning">
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
                    {t("agents.approvals.action", { action: row.actionType })} ·{" "}
                    {t(APPROVAL_KIND_KEYS[row.kind])}
                  </span>
                  <code className="truncate font-mono text-[10px] text-muted-foreground">
                    {t("agents.approvals.hash", {
                      hash: row.planHash.slice(0, 14),
                    })}
                  </code>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
                {t(APPROVAL_KIND_KEYS[detail.kind])} · {detail.actionType}
              </span>
            </div>
            {effectiveStatus === "pending" ? (
              <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
                {t("agents.approvals.expires", {
                  time: formatRelative(detail.expiresAt, lang, now),
                })}
              </p>
            ) : null}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ApprovalMetaRow label={t("agentControl.approvals.board")}>
                {boardTitle}
              </ApprovalMetaRow>
              <ApprovalMetaRow label={t("agentControl.approvals.token")}>
                <code className="font-mono text-[10px]">
                  {detail.requestedByTokenId}
                </code>
              </ApprovalMetaRow>
              <ApprovalMetaRow label={t("agentControl.approvals.session")}>
                {detail.agentSessionId ? (
                  <code className="font-mono text-[10px]">
                    {detail.agentSessionId}
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
                    {detail.cardId}
                  </span>
                )}
              </ApprovalMetaRow>
              <ApprovalMetaRow label={t("agentControl.approvals.created")}>
                {formatDate(detail.createdAt, lang)}
              </ApprovalMetaRow>
              <ApprovalMetaRow label={t("agentControl.approvals.decidedBy")}>
                {detail.decidedBy ?? t("agentControl.approvals.notDecided")}
              </ApprovalMetaRow>
              {detail.decidedAt !== null ? (
                <ApprovalMetaRow label={t("agentControl.approvals.decidedAt")}>
                  {formatDate(detail.decidedAt, lang)}
                </ApprovalMetaRow>
              ) : null}
              {detail.consumedAt !== null ? (
                <ApprovalMetaRow label={t("agentControl.approvals.consumedAt")}>
                  {formatDate(detail.consumedAt, lang)}
                </ApprovalMetaRow>
              ) : null}
            </dl>
            <ApprovalLinks approval={detail} />
            {detail.decisionComment !== null ? (
              <div className="space-y-1" data-testid="agents-approval-comment">
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
        )}
      </div>
      {detail !== null && effectiveStatus !== undefined ? (
        <footer className="shrink-0 border-t border-border px-4 py-3">
          {canDecide ? (
            <div className="flex flex-wrap items-center gap-2">
              <ApprovalDecisionForm
                key={detail.id}
                busy={busy}
                onDecide={decide}
              />
              <ApprovalCancelButton busy={busy} onCancel={cancel} />
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
