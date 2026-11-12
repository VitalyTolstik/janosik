import { useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CircleSlash,
  Copy,
  Folder,
  History,
  KeyRound,
  Link2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  ApprovalRequestDto,
  ApprovalRisk,
  ApprovalStatus,
} from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
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
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { APPROVAL_RISK_KEYS, APPROVAL_STATUS_KEYS } from "@/utils/approval";

const RELATED_CLASS =
  "inline-flex h-[22px] items-center gap-1 rounded border border-border bg-[color-mix(in_oklab,var(--surface)_45%,transparent)] px-1.5 text-[11px] text-muted-foreground hover:border-[color-mix(in_oklab,var(--muted-foreground)_30%,var(--border))] hover:text-foreground";

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
        "inline-flex h-[21px] shrink-0 items-center rounded border px-1.5 text-[11px] font-semibold whitespace-nowrap",
        RISK_CLASS[risk],
      )}
    >
      {t(APPROVAL_RISK_KEYS[risk])}
    </span>
  );
}

export function ApprovalPlanBlock({
  approval,
  title,
  countLabel,
}: {
  approval: ApprovalRequestDto;
  title?: string;
  countLabel?: string;
}) {
  const { t } = useI18n();
  const commands = approval.plan?.commands ?? [];
  const operations = approval.plan?.operations ?? [];
  return (
    <section className="space-y-2" data-testid="approval-plan">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">
          {title ?? t("agentControl.approvals.plan")}
        </h4>
        {countLabel !== undefined ? (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {countLabel}
          </span>
        ) : null}
      </div>
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

export function ApprovalHash({
  hash,
  title,
  badge,
  hint,
}: {
  hash: string;
  title?: string;
  badge?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(hash).then(
      () => {
        setCopied(true);
        toast.success(t("agents.approvals.copiedToast"));
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">
          {title ?? t("agentControl.approvals.planHash")}
        </h4>
        {badge !== undefined ? (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="flex items-start gap-2">
        <code
          data-testid="approval-plan-hash"
          className="min-w-0 flex-1 break-all rounded-md border bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground"
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
      {hint !== undefined ? (
        <p className="text-[11px] leading-5 text-muted-foreground">{hint}</p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {copied ? t("agentControl.approvals.copied") : ""}
      </span>
    </div>
  );
}

function shorten(value: string, max = 12): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Deep links always carry the board id; the token opens an info dialog. */
export function ApprovalLinks({ approval }: { approval: ApprovalRequestDto }) {
  const { t } = useI18n();
  const toast = useToast();
  const base = `${routes.agents}?board=${encodeURIComponent(approval.boardId)}&section=attention`;
  const sessionHref =
    approval.agentSessionId === null
      ? `${routes.agents}?board=${encodeURIComponent(approval.boardId)}&section=sessions&token=${encodeURIComponent(approval.requestedByTokenId)}`
      : `${routes.agents}?board=${encodeURIComponent(approval.boardId)}&section=sessions&session=${encodeURIComponent(approval.agentSessionId)}`;
  const runHref =
    approval.runId === null
      ? null
      : `${routes.agents}?board=${encodeURIComponent(approval.boardId)}&section=runs&run=${encodeURIComponent(approval.runId)}`;
  const [copied, setCopied] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  const copyLink = () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    const url = `${window.location.origin}${base}&approval=${encodeURIComponent(approval.id)}`;
    void clipboard.writeText(url).then(
      () => {
        setCopied(true);
        toast.success(t("agents.approvals.copiedToast"));
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5" data-testid="approval-links">
        <Link
          to={routes.board(approval.boardId)}
          className={RELATED_CLASS}
          data-testid="approval-board-link"
        >
          <Folder className="h-2.5 w-2.5" aria-hidden />
          {t("agents.approvals.openBoard")}
        </Link>
        <Link
          to={sessionHref}
          className={RELATED_CLASS}
          data-testid="approval-session-link"
        >
          <Activity className="h-2.5 w-2.5" aria-hidden />
          {t("agentControl.approvals.openSession")}
        </Link>
        {runHref !== null ? (
          <Link
            to={runHref}
            className={RELATED_CLASS}
            data-testid="approval-run-link"
          >
            <History className="h-2.5 w-2.5" aria-hidden />
            {t("agentControl.approvals.openRun")}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setTokenOpen(true)}
          className={RELATED_CLASS}
          data-testid="approval-token-link"
        >
          <KeyRound className="h-2.5 w-2.5" aria-hidden />
          {t("agents.approvals.tokenLabel", {
            token: shorten(approval.requestedByTokenId),
          })}
        </button>
        <button
          type="button"
          onClick={copyLink}
          className={RELATED_CLASS}
          data-testid="approval-copy-link"
        >
          {copied ? (
            <Check className="h-2.5 w-2.5 text-success" aria-hidden />
          ) : (
            <Link2 className="h-2.5 w-2.5" aria-hidden />
          )}
          {t("agents.approvals.copyLink")}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? t("agentControl.approvals.copied") : ""}
      </span>

      <Dialog open={tokenOpen} onOpenChange={setTokenOpen}>
        <DialogContent
          className="sm:max-w-sm"
          data-testid="approval-token-dialog"
          hideClose
        >
          <DialogHeader>
            <DialogTitle>
              {t("agents.approvals.tokenInfoTitle", {
                token: shorten(approval.requestedByTokenId),
              })}
            </DialogTitle>
            <DialogDescription>
              {t("agents.approvals.tokenInfoDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[11px] leading-[1.5] text-muted-foreground">
            <code className="block rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] break-all">
              {approval.requestedByTokenId}
            </code>
            <p className="rounded-md border border-danger/30 bg-danger/5 p-2.5">
              {t("agents.approvals.tokenInfoBody")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setTokenOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApprovalDecisionForm({
  busy,
  planHash,
  impactTitle,
  impactText,
  initialMode = null,
  onDecide,
}: {
  busy: boolean;
  planHash: string;
  /** Human impact shown in the approve confirmation, mock-style. */
  impactTitle?: string;
  impactText?: string;
  /** Quick-reject opens straight into the reason form. */
  initialMode?: "reject" | null;
  onDecide: (
    decision: "approve" | "reject",
    comment: string,
  ) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"reject" | null>(initialMode);
  const [approveOpen, setApproveOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reasonRequired = comment.trim() === "";

  const resetReject = () => {
    setMode(null);
    setComment("");
  };

  const submitReject = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || busy || reasonRequired) return;
    setSubmitting(true);
    try {
      const ok = await onDecide("reject", comment.trim());
      if (ok) resetReject();
    } finally {
      setSubmitting(false);
    }
  };

  const submitApprove = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    try {
      const ok = await onDecide("approve", "");
      if (ok) setApproveOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "reject") {
    return (
      <form noValidate onSubmit={submitReject} className="space-y-1.5">
        <label
          htmlFor="approval-comment"
          className="block text-[10.5px] font-semibold text-foreground"
        >
          {t("agents.approvals.rejectReason")}{" "}
          <span className="font-normal text-muted-foreground">
            {t("agents.approvals.required")}
          </span>
        </label>
        <Textarea
          id="approval-comment"
          data-testid="approval-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t("agentControl.approvals.rejectReasonPlaceholder")}
          className="min-h-14 resize-y rounded-[5px] border-border bg-background px-2 py-1.5 text-[11px]"
          autoFocus
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={resetReject}
            disabled={submitting}
            className="h-7 min-h-0 px-2 text-[11px] text-muted-foreground"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            data-testid="approval-confirm"
            disabled={submitting || busy || reasonRequired}
            className="h-7 min-h-0 px-2.5 text-[11px] font-[650]"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            {t("agents.approvals.rejectConfirm")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground">
        <ShieldCheck
          className="mt-px h-[11px] w-[11px] shrink-0 text-success"
          aria-hidden
        />
        <span>
          {t("agents.approvals.footerBefore")}{" "}
          <b className="font-semibold text-foreground">
            {t("agents.approvals.footerHash")}
          </b>
          {t("agents.approvals.footerAfter")}
        </span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="approval-reject"
          onClick={() => setMode("reject")}
          disabled={busy}
          className="h-8 min-h-0 flex-1 rounded-md px-2.5 text-[11.5px] font-[650]"
        >
          {t("agentControl.approvals.reject")}
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="approval-approve"
          onClick={() => setApproveOpen(true)}
          disabled={busy}
          className="h-8 min-h-0 flex-1 rounded-md px-2.5 text-[11.5px] font-[650]"
        >
          {t("agents.approvals.confirmApprove")}
        </Button>
      </div>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent
          className="w-[min(440px,calc(100vw-1.5rem))] max-w-[440px] gap-0 overflow-hidden rounded-[10px] border-border bg-surface p-0"
          data-testid="approval-approve-dialog"
          hideClose
        >
          <DialogHeader className="flex flex-row items-start gap-2.5 px-4 pt-3.5 pb-2.5 text-left">
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border border-border bg-background/40 text-warning">
              <ShieldCheck className="h-[15px] w-[15px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[14px] font-[650] leading-[1.3] tracking-normal">
                {t("agents.approvals.approveTitle")}
              </DialogTitle>
              <DialogDescription className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">
                {t("agents.approvals.approveDescription")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="px-4 pb-0.5">
            <div className="mt-2.5 rounded-r-[5px] border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-2.5 py-2 text-[11px] text-foreground">
              <b className="block font-[650]">
                {impactTitle ?? t("agents.approvals.approveImpactTitle")}
              </b>
              <p className="mt-0.5 text-[11px] leading-[1.5] text-muted-foreground">
                {impactText ?? t("agents.approvals.approveImpactBody")}
              </p>
            </div>
            <div className="mt-2.5 flex min-w-0 items-center gap-1.5 rounded-[5px] border border-border bg-background/30 px-1.5 py-1">
              <code
                title={planHash}
                className="min-w-0 flex-1 overflow-hidden font-mono text-[9.5px] whitespace-nowrap text-ellipsis text-muted-foreground"
              >
                {planHash.slice(0, 34)}…
              </code>
            </div>
          </div>
          <DialogFooter className="px-4 pt-3 pb-3.5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setApproveOpen(false)}
              disabled={submitting}
              className="h-7 min-h-0 rounded-md px-2.5 text-[11px] font-[650] text-muted-foreground"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              data-testid="approval-confirm"
              onClick={() => void submitApprove()}
              disabled={submitting || busy}
              className="h-7 min-h-0 rounded-md px-2.5 text-[11px] font-[650]"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {t("agents.approvals.confirmApprove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApprovalCancelButton({
  busy,
  onCancel,
  disabled = false,
  className,
}: {
  busy: boolean;
  onCancel: () => Promise<boolean>;
  disabled?: boolean;
  className?: string;
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
        className={cn("text-muted-foreground hover:text-foreground", className)}
      >
        <CircleSlash className="h-2.5 w-2.5" aria-hidden />
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
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
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
