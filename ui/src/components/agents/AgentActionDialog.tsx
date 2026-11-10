import { useState } from "react";

import type { AgentSessionDto } from "@janosik/shared";

import { ApiError, api } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import type { AgentSessionRow } from "./agent-model";

export type AgentSessionAction = "pause" | "resume" | "end";

const END_STATUSES = ["completed", "failed", "cancelled"] as const;
type EndStatus = (typeof END_STATUSES)[number];

const REASON_MAX = 500;
const SUMMARY_MAX = 2000;

/**
 * Human control of one session (TASK-166.3): pause/resume with an optional
 * reason, or end the run context with a final status and summary. Mounted
 * only while open, so the draft cannot leak between sessions.
 */
export function AgentActionDialog({
  action,
  row,
  onClose,
  onSaved,
}: {
  action: AgentSessionAction;
  row: AgentSessionRow;
  onClose: () => void;
  onSaved: (session: AgentSessionDto) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<EndStatus>("completed");
  const [busy, setBusy] = useState(false);

  const title =
    action === "pause"
      ? t("agents.action.pauseTitle")
      : action === "resume"
        ? t("agents.action.resumeTitle")
        : t("agents.action.endTitle");
  const body =
    action === "pause"
      ? t("agents.action.pauseBody")
      : action === "resume"
        ? t("agents.action.resumeBody")
        : t("agents.action.endBody");
  const confirmLabel =
    action === "pause"
      ? t("agents.action.confirmPause")
      : action === "resume"
        ? t("agents.action.confirmResume")
        : t("agents.action.confirmEnd");

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const updated =
        action === "pause"
          ? await api.pauseAgentSession(
              row.boardId,
              row.id,
              reason.trim() || undefined,
            )
          : action === "resume"
            ? await api.resumeAgentSession(
                row.boardId,
                row.id,
                reason.trim() || undefined,
              )
            : await api.endAgentSession(row.boardId, row.id, {
                status,
                ...(summary.trim() === "" ? {} : { summary: summary.trim() }),
              });
      onSaved(updated);
      toast.success(
        t(
          action === "pause"
            ? "agents.toast.paused"
            : action === "resume"
              ? "agents.toast.resumed"
              : "agents.toast.ended",
        ),
      );
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 403) {
          toast.error(t("agents.toast.forbidden"));
        } else if (error.status === 409) {
          toast.error(t("agents.toast.closed"));
        } else if (error.status === 0) {
          toast.error(t("agents.toast.offline"));
        } else {
          toast.error(t("agents.toast.failed"));
        }
      } else {
        toast.error(t("agents.toast.failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row.name ?? row.tokenName ?? row.id} · {row.boardTitle}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p className="text-xs leading-5">{body}</p>
          {action === "end" ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">
                {t("agents.action.finalStatus")}
              </span>
              <SelectField<EndStatus>
                value={status}
                onChange={setStatus}
                options={END_STATUSES.map((value) => ({
                  value,
                  label: t(`agents.action.${value}`),
                }))}
                ariaLabel={t("agents.action.finalStatus")}
                testId="agent-end-status"
              />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">
                {t("agents.action.reason")}
              </span>
              <Textarea
                value={reason}
                maxLength={REASON_MAX}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("agents.action.reasonPlaceholder")}
                data-testid="agent-action-reason"
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">
              {t("agents.action.summary")}
            </span>
            <Textarea
              value={summary}
              maxLength={SUMMARY_MAX}
              rows={3}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t("agents.action.summaryPlaceholder")}
              data-testid="agent-action-summary"
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={onClose}
            data-testid="agent-action-cancel"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={action === "end" ? "destructive" : "default"}
            disabled={busy}
            onClick={() => void submit()}
            data-testid="agent-action-confirm"
          >
            {busy ? t("agents.action.busy") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
