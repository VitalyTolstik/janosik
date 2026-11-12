import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import type {
  ApprovalRequestDto,
  ApprovalRisk,
  ApprovalStatus,
} from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { APPROVAL_RISK_KEYS, APPROVAL_STATUS_KEYS } from "@/utils/approval";

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

function approvalStatusLabel(
  t: ReturnType<typeof useI18n>["t"],
  status: ApprovalStatus,
): string {
  return t(APPROVAL_STATUS_KEYS[status]);
}

export function ApprovalStatusBadge({
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
      {approvalStatusLabel(t, status)}
    </span>
  );
}

export function ApprovalRiskBadge({
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
      {t(APPROVAL_RISK_KEYS[risk])}
    </span>
  );
}

export function ApprovalPlanBlock({
  approval,
}: {
  approval: ApprovalRequestDto;
}) {
  const { t } = useI18n();
  const commands = approval.plan?.commands ?? [];
  const operations = approval.plan?.operations ?? [];
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

export function ApprovalHash({ hash }: { hash: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(hash).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold">
        {t("agentControl.approvals.planHash")}
      </h4>
      <div className="flex items-start gap-2">
        <code
          data-testid="approval-plan-hash"
          className="min-w-0 flex-1 break-all rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground"
        >
          {hash}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={copy}
          aria-label={t("agentControl.approvals.copyHash")}
          data-testid="approval-copy-hash"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? t("agentControl.approvals.copied") : ""}
      </span>
    </div>
  );
}

/** Card/session/run deep links always carry the board id. */
export function ApprovalLinks({ approval }: { approval: ApprovalRequestDto }) {
  const { t } = useI18n();
  const base = `${routes.agents}?board=${encodeURIComponent(approval.boardId)}`;
  const cardHref =
    approval.cardId === null
      ? null
      : `${routes.board(approval.boardId)}?card=${encodeURIComponent(approval.cardId)}`;
  const sessionHref =
    approval.agentSessionId === null
      ? null
      : `${base}&session=${encodeURIComponent(approval.agentSessionId)}`;
  const runHref =
    approval.runId === null
      ? null
      : `${base}&run=${encodeURIComponent(approval.runId)}`;
  if (cardHref === null && sessionHref === null && runHref === null) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {cardHref ? (
        <a
          href={cardHref}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          data-testid="approval-card-link"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {t("agentControl.approvals.openCard")}
        </a>
      ) : null}
      {sessionHref ? (
        <a
          href={sessionHref}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          data-testid="approval-session-link"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {t("agentControl.approvals.openSession")}
        </a>
      ) : null}
      {runHref ? (
        <a
          href={runHref}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          data-testid="approval-run-link"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {t("agentControl.approvals.openRun")}
        </a>
      ) : null}
    </div>
  );
}

export function ApprovalDecisionForm({
  busy,
  onDecide,
}: {
  busy: boolean;
  onDecide: (
    decision: "approve" | "reject",
    comment: string,
  ) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const reasonRequired = mode === "reject" && comment.trim() === "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === null || submitting || busy) return;
    if (reasonRequired) {
      setTouched(true);
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onDecide(mode, comment.trim());
      if (ok) {
        setMode(null);
        setComment("");
        setTouched(false);
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
          {mode === "reject"
            ? t("agentControl.approvals.rejectReasonLabel")
            : t("agentControl.approvals.commentLabel")}
        </label>
        <Textarea
          id="approval-comment"
          data-testid="approval-comment"
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
            if (touched) setTouched(false);
          }}
          onBlur={() => {
            if (mode === "reject") setTouched(true);
          }}
          rows={2}
          maxLength={2000}
          placeholder={t("agentControl.approvals.commentPlaceholder")}
          aria-invalid={touched && reasonRequired}
          aria-describedby={
            touched && reasonRequired ? "approval-comment-required" : undefined
          }
          autoFocus
        />
        {touched && reasonRequired ? (
          <p
            id="approval-comment-required"
            role="alert"
            className="text-[11px] text-danger"
            data-testid="approval-reject-reason-required"
          >
            {t("agentControl.approvals.rejectReasonRequired")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="approval-confirm"
          disabled={submitting || busy || reasonRequired}
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
            setTouched(false);
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

export function ApprovalCancelButton({
  busy,
  onCancel,
  disabled = false,
}: {
  busy: boolean;
  onCancel: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="approval-cancel"
        disabled={busy || disabled}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        {t("agentControl.approvals.cancelRequest")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("agentControl.approvals.cancelTitle")}
        description={t("agentControl.approvals.cancelDescription")}
        confirmLabel={t("agentControl.approvals.cancelConfirm")}
        destructive
        onConfirm={() => {
          void onCancel();
        }}
      />
    </>
  );
}

export function ApprovalMetaRow({
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

export function ApprovalDetailError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
      <p>{t("agentControl.approvals.detailError")}</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {t("agentControl.retry")}
      </Button>
    </div>
  );
}
