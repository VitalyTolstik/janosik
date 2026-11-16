import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Square } from "lucide-react";

import type { AgentSessionDto } from "@janosik/shared";

import { ApiError, api } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type AgentSessionAction = "pause" | "resume" | "end";

/**
 * The fields the confirmation dialog needs. `AgentSessionRow` satisfies it,
 * and the board Live panel can pass a plain session plus its board label
 * without inventing a full console row.
 */
export interface AgentActionTarget {
  id: string;
  boardId: string;
  apiTokenId: string;
  name: string | null;
  boardTitle: string;
  tokenName: string | null;
  /** Display label for the agent/token, when the caller already resolved one. */
  agentLabel?: string | null;
  /** Current card title, shown in the end confirmation like the mockup. */
  cardTitle?: string | null;
}

const REASON_MAX = 500;

/**
 * Human control of one session (TASK-166.3): pause/resume with an optional
 * reason, or end the run context. The layout follows the tracked mockup:
 * a compact icon header, one field (pause) or one target row (end), and the
 * two footer actions — no final-status select or summary field.
 */
export function AgentActionDialog({
  action,
  row,
  onClose,
  onSaved,
}: {
  action: AgentSessionAction;
  row: AgentActionTarget;
  onClose: () => void;
  onSaved: (session: AgentSessionDto) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // The dialog is mounted/unmounted by the parent action state, so restore
  // focus explicitly: a nested Dialog inside the Agent Control modal loses
  // the browser's default return target when the whole content unmounts.
  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    return () => {
      const target = returnFocusRef.current;
      if (target === null) return;
      window.setTimeout(() => {
        if (
          target.isConnected &&
          target.closest('[aria-hidden="true"]') === null
        ) {
          target.focus();
        }
      }, 0);
    };
  }, []);

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
  const Icon = action === "pause" ? Pause : action === "resume" ? Play : Square;
  const agentLabel = row.agentLabel ?? row.tokenName ?? row.name ?? row.id;

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
                status: "completed",
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
      <DialogContent
        hideClose
        className="w-[min(440px,calc(100vw-1.5rem))] max-w-[440px] gap-0 overflow-hidden rounded-[10px] border-border bg-surface p-0 sm:rounded-[10px]"
        data-testid="agent-action-dialog"
      >
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
          <span
            className={cn(
              "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border bg-background/40",
              action === "end"
                ? "border-danger/40 text-[color:var(--agent-tone-danger)]"
                : "border-border text-muted-foreground",
            )}
            aria-hidden
          >
            <Icon className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-[14px] font-[650] leading-[1.3] tracking-normal">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">
              {body}
            </DialogDescription>
          </div>
        </div>

        <div className="px-4 pb-0.5">
          {action === "end" ? (
            <p
              data-testid="agent-end-target"
              className="mt-[10px] rounded-r-[5px] border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-[9px] py-[7.25px] text-[11px] leading-[1.5] text-foreground"
            >
              {agentLabel}
              {row.name !== null && row.name !== agentLabel
                ? ` · ${row.name}`
                : ""}
              {row.cardTitle != null && row.cardTitle !== ""
                ? ` · ${row.cardTitle}`
                : ""}
            </p>
          ) : (
            <label className="mt-[10px] mb-[2.3px] block space-y-[3.3px] text-[10.5px] leading-[1.45]">
              <span className="block text-[10.5px] font-semibold text-muted-foreground">
                {t("agents.action.reason")}
              </span>
              <Textarea
                value={reason}
                maxLength={REASON_MAX}
                rows={2}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("agents.action.reasonPlaceholder")}
                data-testid="agent-action-reason"
                className="min-h-[70px] resize-y rounded-[6px] border-border bg-background px-2 py-2 text-[11.5px] leading-[1.55] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
                autoFocus
              />
            </label>
          )}
        </div>

        <DialogFooter className="!flex-row items-center justify-end gap-[7px] px-4 pt-3 pb-3.5">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={onClose}
            data-testid="agent-action-cancel"
            className="!gap-[6px] h-7 min-h-0 min-w-[61px] !py-0 rounded-[6px] px-[9px] !leading-none text-[11px] font-[650] text-muted-foreground max-md:min-h-11"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="agent-action-confirm"
            className={cn(
              "!gap-[6px] h-7 min-h-0 !py-0 rounded-[6px] px-[9px] !leading-none text-[11px] font-[650] max-md:min-h-11",
              action === "end" ? "min-w-[93px]" : "min-w-[107px]",
              action === "end"
                ? "!bg-[var(--agent-danger-strong)] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:!bg-[color-mix(in_oklab,var(--agent-danger-strong)_88%,#000)]"
                : "!bg-[var(--agent-primary-strong)] shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:!bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)]",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            {busy ? t("agents.action.busy") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
