import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CirclePause,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import type {
  BoardAgentPolicy,
  BoardAgentPolicyAction,
  BoardAgentPolicyStateDto,
} from "@janosik/shared";
import { BOARD_AGENT_POLICY_ACTIONS } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberStepper } from "@/components/ui/number-stepper";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { formatDate, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";

type Role = "ADMIN" | "MEMBER" | "VIEWER" | undefined;
type Translate = ReturnType<typeof useI18n>["t"];

const ACTION_KEYS: Record<BoardAgentPolicyAction, MessageKey> = {
  move_to_done: "agentControl.policy.action.moveToDone",
  delete_card: "agentControl.policy.action.deleteCard",
  delete_column: "agentControl.policy.action.deleteColumn",
  delete_label: "agentControl.policy.action.deleteLabel",
  delete_checklist: "agentControl.policy.action.deleteChecklist",
  delete_checklist_item: "agentControl.policy.action.deleteChecklistItem",
  archive_column_cards: "agentControl.policy.action.archiveColumnCards",
  delete_board: "agentControl.policy.action.deleteBoard",
  "member.invite": "agentControl.policy.action.memberInvite",
  "member.update": "agentControl.policy.action.memberUpdate",
  "member.remove": "agentControl.policy.action.memberRemove",
  "share.create": "agentControl.policy.action.shareCreate",
  "share.update": "agentControl.policy.action.shareUpdate",
  "share.revoke": "agentControl.policy.action.shareRevoke",
  "share.delete": "agentControl.policy.action.shareDelete",
  "attachment.delete": "agentControl.policy.action.attachmentDelete",
  "workflow.update": "agentControl.policy.action.workflowUpdate",
};

interface PolicyDraft {
  destructive: "approval" | "deny";
  requireApprovalFor: BoardAgentPolicyAction[];
  maxCommandsPerRun: string;
  maxCardsPerRun: string;
  approvalTtlMinutes: string;
}

function draftOf(policy: BoardAgentPolicy): PolicyDraft {
  return {
    destructive: policy.destructive,
    requireApprovalFor: [...policy.requireApprovalFor],
    maxCommandsPerRun: String(policy.maxCommandsPerRun),
    maxCardsPerRun: String(policy.maxCardsPerRun),
    approvalTtlMinutes: String(policy.approvalTtlMinutes),
  };
}

function intInRange(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function errorCodeOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function currentVersionOf(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body === null || typeof body !== "object") return null;
  const record = body as {
    currentVersion?: unknown;
    details?: { currentVersion?: unknown };
  };
  const value = record.currentVersion ?? record.details?.currentVersion;
  return typeof value === "number" ? value : null;
}

function policyError(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  switch (errorCodeOf(error)) {
    case "version_conflict": {
      const current = currentVersionOf(error);
      return current === null
        ? t("agentControl.policy.conflict")
        : t("agentControl.policy.conflictVersion", { version: current });
    }
    case "pat_forbidden":
      return t("agentControl.policy.sessionOnly");
    case "scope_denied":
      return t("agentControl.policy.adminOnly");
    default:
      break;
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

export function PolicyPanel({ role }: { role: Role }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const live = useBoardLive();
  const boardId = board?.id;
  const admin = role === "ADMIN";

  const [state, setState] = useState<BoardAgentPolicyStateDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(() => {
    if (!admin || boardId === undefined || !isApiEnabled()) return;
    setLoadError(false);
    setState(null);
    void api
      .getBoardAgentPolicy(boardId)
      .then((next) => {
        setState(next);
        setDraft(draftOf(next.policy ?? next.effective));
      })
      .catch(() => setLoadError(true));
  }, [admin, boardId]);

  useEffect(() => {
    load();
  }, [load, revision]);

  // The live board-pause frame flips the operational status without a reload.
  const [, setLiveTick] = useState(0);
  useEffect(
    () => live.agentControl.subscribe(() => setLiveTick((value) => value + 1)),
    [live],
  );
  const livePause = live.agentControl.getBoardPause(boardId);
  const paused =
    livePause?.paused ??
    (state?.paused === true ||
      (board?.agentsPausedAt !== undefined && board.agentsPausedAt !== null));
  const pausedAt =
    livePause?.paused === false
      ? null
      : (livePause?.at ?? state?.pausedAt ?? board?.agentsPausedAt ?? null);
  const pauseReason =
    livePause?.paused === false
      ? null
      : (livePause?.reason ??
        state?.pauseReason ??
        board?.agentsPauseReason ??
        null);

  const limits = useMemo(() => {
    if (draft === null) return null;
    return {
      maxCommandsPerRun: intInRange(draft.maxCommandsPerRun, 1, 100),
      maxCardsPerRun: intInRange(draft.maxCardsPerRun, 1, 50),
      approvalTtlMinutes: intInRange(draft.approvalTtlMinutes, 5, 1440),
    };
  }, [draft]);
  const draftValid =
    limits !== null &&
    limits.maxCommandsPerRun !== null &&
    limits.maxCardsPerRun !== null &&
    limits.approvalTtlMinutes !== null;

  const toggleAction = (action: BoardAgentPolicyAction) => {
    setDraft((current) => {
      if (current === null) return current;
      const active = current.requireApprovalFor.includes(action);
      return {
        ...current,
        requireApprovalFor: active
          ? current.requireApprovalFor.filter((entry) => entry !== action)
          : [...current.requireApprovalFor, action],
      };
    });
  };

  const save = async (policy: BoardAgentPolicy | null) => {
    if (boardId === undefined || state === null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api.updateBoardAgentPolicy(boardId, {
        policy,
        version: state.version,
      });
      setState(next);
      setDraft(draftOf(next.policy ?? next.effective));
      toast.success(
        policy === null
          ? t("agentControl.policy.resetToast")
          : t("agentControl.policy.savedToast"),
      );
      setResetOpen(false);
    } catch (error) {
      setSaveError(policyError(error, t));
      setResetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => {
    if (draft === null || limits === null || !draftValid) return;
    const { maxCommandsPerRun, maxCardsPerRun, approvalTtlMinutes } = limits;
    if (
      maxCommandsPerRun === null ||
      maxCardsPerRun === null ||
      approvalTtlMinutes === null
    ) {
      return;
    }
    void save({
      schemaVersion: 1,
      destructive: draft.destructive,
      requireApprovalFor: draft.requireApprovalFor,
      approverRoles: ["ADMIN"],
      maxCommandsPerRun,
      maxCardsPerRun,
      approvalTtlMinutes,
    });
  };

  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t("agentControl.policy.offline")}
      </p>
    );
  }

  if (!admin) {
    return (
      <p
        className="p-4 text-xs text-muted-foreground"
        data-testid="agent-policy-read-only"
      >
        {t("agentControl.policy.adminOnly")}
      </p>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto p-4"
      data-testid="agent-policy-panel"
    >
      {loadError ? (
        <div className="space-y-2">
          <p className="text-xs text-danger">
            {t("agentControl.policy.loadError")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("agentControl.retry")}
          </Button>
        </div>
      ) : state === null || draft === null ? (
        <SkeletonRegion
          label={t("agentControl.policy.loading")}
          testId="agent-policy-skeleton"
        >
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="rounded-lg border p-3">
                <Skeleton width={180} height={12} />
                <Skeleton width={260} height={10} className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      ) : (
        <div className="space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                {t("agentControl.policy.title")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("agentControl.policy.description")}
              </p>
            </div>
            <span
              data-testid="agent-policy-version"
              className="rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {t("agentControl.policy.version", { version: state.version })}
            </span>
          </header>

          <section
            data-testid="agent-policy-pause"
            data-paused={paused ? "true" : "false"}
            className={cn(
              "flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3",
              paused ? "border-warning/40 bg-warning/10" : "bg-muted/20",
            )}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <CirclePause
                  className={cn(
                    "h-4 w-4",
                    paused ? "text-warning" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                {paused
                  ? t("agentControl.policy.pausedTitle")
                  : t("agentControl.policy.runningTitle")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {paused
                  ? t("agentControl.policy.pausedExplanation", {
                      date:
                        pausedAt === null
                          ? "—"
                          : formatDate(pausedAt, lang, true),
                    })
                  : t("agentControl.policy.runningExplanation")}
              </p>
              {paused && pauseReason !== null ? (
                <p className="text-[11px] text-warning">{pauseReason}</p>
              ) : null}
            </div>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("agentControl.policy.pauseSeparate")}
            </span>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold">
              {t("agentControl.policy.effectiveLimits")}
            </h4>
            <div
              className="grid gap-2 text-[11px] sm:grid-cols-3"
              data-testid="agent-policy-effective-limits"
            >
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">
                  {t("agentControl.policy.maxCommands")}
                </p>
                <p className="text-sm font-semibold">
                  {state.effective.maxCommandsPerRun}
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">
                  {t("agentControl.policy.maxCards")}
                </p>
                <p className="text-sm font-semibold">
                  {state.effective.maxCardsPerRun}
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-muted-foreground">
                  {t("agentControl.policy.ttl")}
                </p>
                <p className="text-sm font-semibold">
                  {state.effective.approvalTtlMinutes}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("agentControl.policy.limitsHint")}
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold">
              {t("agentControl.policy.destructiveTitle")}
            </h4>
            <SelectField
              value={draft.destructive}
              options={[
                {
                  value: "approval",
                  label: t("agentControl.policy.destructiveApproval"),
                },
                {
                  value: "deny",
                  label: t("agentControl.policy.destructiveDeny"),
                },
              ]}
              onChange={(value) =>
                setDraft((current) =>
                  current === null
                    ? current
                    : { ...current, destructive: value },
                )
              }
              ariaLabel={t("agentControl.policy.destructiveTitle")}
              testId="agent-policy-destructive"
            />
            <p className="text-[11px] text-muted-foreground">
              {draft.destructive === "deny"
                ? t("agentControl.policy.destructiveDenyHint")
                : t("agentControl.policy.destructiveApprovalHint")}
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold">
              {t("agentControl.policy.approvalListTitle")}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {t("agentControl.policy.approvalListHint")}
            </p>
            <div
              className="grid gap-1.5 rounded-md border p-2 sm:grid-cols-2"
              data-testid="agent-policy-require-list"
            >
              {BOARD_AGENT_POLICY_ACTIONS.map((action) => (
                <label
                  key={action}
                  className="flex cursor-pointer items-start gap-2 text-[11px]"
                >
                  <Checkbox
                    checked={draft.requireApprovalFor.includes(action)}
                    onCheckedChange={() => toggleAction(action)}
                    data-testid={`agent-policy-require-${action}`}
                    aria-label={t(ACTION_KEYS[action])}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block">{t(ACTION_KEYS[action])}</span>
                    <code className="block text-[10px] text-muted-foreground">
                      {action}
                    </code>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("agentControl.policy.approverRoles")}
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold">
              {t("agentControl.policy.limitInputsTitle")}
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-[11px] text-muted-foreground">
                <span>{t("agentControl.policy.maxCommands")}</span>
                <NumberStepper
                  value={draft.maxCommandsPerRun}
                  onChange={(value) =>
                    setDraft((current) =>
                      current === null
                        ? current
                        : { ...current, maxCommandsPerRun: value },
                    )
                  }
                  min={1}
                  max={100}
                  testId="agent-policy-max-commands"
                  ariaLabel={t("agentControl.policy.maxCommands")}
                  increaseLabel={t("agentControl.policy.increase")}
                  decreaseLabel={t("agentControl.policy.decrease")}
                  invalid={limits?.maxCommandsPerRun === null}
                />
                <span className="block text-[10px]">
                  {t("agentControl.policy.range", { min: 1, max: 100 })}
                </span>
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                <span>{t("agentControl.policy.maxCards")}</span>
                <NumberStepper
                  value={draft.maxCardsPerRun}
                  onChange={(value) =>
                    setDraft((current) =>
                      current === null
                        ? current
                        : { ...current, maxCardsPerRun: value },
                    )
                  }
                  min={1}
                  max={50}
                  testId="agent-policy-max-cards"
                  ariaLabel={t("agentControl.policy.maxCards")}
                  increaseLabel={t("agentControl.policy.increase")}
                  decreaseLabel={t("agentControl.policy.decrease")}
                  invalid={limits?.maxCardsPerRun === null}
                />
                <span className="block text-[10px]">
                  {t("agentControl.policy.range", { min: 1, max: 50 })}
                </span>
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                <span>{t("agentControl.policy.ttl")}</span>
                <NumberStepper
                  value={draft.approvalTtlMinutes}
                  onChange={(value) =>
                    setDraft((current) =>
                      current === null
                        ? current
                        : { ...current, approvalTtlMinutes: value },
                    )
                  }
                  min={5}
                  max={1440}
                  testId="agent-policy-ttl"
                  ariaLabel={t("agentControl.policy.ttl")}
                  increaseLabel={t("agentControl.policy.increase")}
                  decreaseLabel={t("agentControl.policy.decrease")}
                  invalid={limits?.approvalTtlMinutes === null}
                />
                <span className="block text-[10px]">
                  {t("agentControl.policy.range", { min: 5, max: 1440 })}
                </span>
              </label>
            </div>
          </section>

          {saveError !== null ? (
            <p
              role="alert"
              data-testid="agent-policy-error"
              className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger"
            >
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              data-testid="agent-policy-save"
              disabled={!draftValid || saving}
              onClick={saveDraft}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("agentControl.policy.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="agent-policy-reset"
              disabled={saving}
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("agentControl.policy.reset")}
            </Button>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {state.policy === null
                ? t("agentControl.policy.usingDefaults")
                : t("agentControl.policy.customPolicy")}
            </span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("agentControl.policy.resetTitle")}
        description={t("agentControl.policy.resetDescription")}
        confirmLabel={t("agentControl.policy.reset")}
        destructive
        onConfirm={() => void save(null)}
      />
    </div>
  );
}
