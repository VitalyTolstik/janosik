import { useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Info,
  RefreshCw,
  RotateCcw,
  Terminal,
} from "lucide-react";
import type { BoardAgentPolicyAction, BoardRole } from "@janosik/shared";

import { isApiEnabled } from "@/api/client";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardState } from "@/store/BoardContext";
import {
  EDITABLE_POLICY_ACTIONS,
  POLICY_LIMITS,
  POLICY_TRIGGER_ORDER,
  isDestructivePolicyAction,
  type PolicyField,
  type PolicyFieldValue,
} from "./policy-model";
import { usePolicyDraft, type PolicySaveError } from "./usePolicyDraft";

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

const FIELD_KEYS: Record<PolicyField, MessageKey> = {
  destructive: "agentControl.policy.destructiveTitle",
  requireApprovalFor: "agentControl.policy.approvalListTitle",
  maxCommandsPerRun: "board.settings.agents.commandsPerRun",
  maxCardsPerRun: "board.settings.agents.cardsPerRun",
  approvalTtlMinutes: "board.settings.agents.approvalTtl",
};

function errorText(error: PolicySaveError | null, t: Translate): string | null {
  if (error === null) return null;
  switch (error.kind) {
    case "offline":
      return t("agentControl.error.offline");
    case "forbidden":
      return t("agentControl.error.forbidden");
    case "pat":
      return t("agentControl.policy.sessionOnly");
    default:
      return t("agentControl.error.generic");
  }
}

function conflictValue(
  field: PolicyField,
  value: PolicyFieldValue,
  other: PolicyFieldValue,
  t: Translate,
): string {
  switch (field) {
    case "destructive":
      return value === "approval"
        ? t("agentControl.policy.destructiveApproval")
        : t("agentControl.policy.destructiveDeny");
    case "requireApprovalFor": {
      const actions = Array.isArray(value) ? value : [];
      const otherActions = Array.isArray(other) ? other : [];
      const otherSet = new Set(otherActions);
      const difference = actions.filter((action) => !otherSet.has(action));
      const visible = difference.length > 0 ? difference : actions;
      return visible.length === 0
        ? t("board.settings.agents.conflictNoTriggers")
        : visible.map((action) => t(ACTION_KEYS[action])).join(", ");
    }
    default:
      return String(value);
  }
}

function PolicyNumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  invalid,
  error,
  testId,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  suffix: string;
  invalid: boolean;
  error: string;
  testId: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const step = (delta: number) => {
    const current = value.trim() === "" ? min : Number(value);
    const next = Math.min(max, Math.max(min, current + delta));
    onChange(String(next));
  };
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="mb-[3px] block text-[11px] font-semibold leading-[1.45] text-muted-foreground"
      >
        {label}
      </label>
      <div
        className={cn(
          "flex h-[30px] items-center overflow-hidden rounded-[5px] border bg-[color-mix(in_oklab,var(--background)_32%,transparent)] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15 max-md:h-11",
          invalid ? "border-danger" : "border-border",
        )}
      >
        <input
          id={id}
          data-testid={testId}
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              step(1);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              step(-1);
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-1.5 text-[11.5px] leading-[1.45] tabular-nums text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11"
        />
        <span className="whitespace-nowrap pr-1.5 text-[11px] leading-[1.45] text-muted-foreground">
          {suffix}
        </span>
      </div>
      {invalid ? (
        <span
          id={errorId}
          className="mt-1 block text-[11px] leading-[1.4] text-[color:var(--agent-tone-danger)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * TASK-179.7 — Board Settings → Agents & automation.
 *
 * The full policy editor: destructive gate, approval triggers, run limits,
 * TTL and the fixed approver role. Dirty state is reported to the Board
 * Settings shell; the field-level CAS merge lives in `usePolicyDraft`.
 */
export function AgentsAutomation({
  role,
  onDirtyChange,
  onOpenLiveControls,
}: {
  role: BoardRole | undefined;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenLiveControls?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const live = useBoardLive();
  const boardId = board?.id;
  const policy = usePolicyDraft({
    boardId,
    enabled: role === "ADMIN",
    onDirtyChange,
  });
  const [showKeys, setShowKeys] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConflictVersion, setResetConflictVersion] = useState<
    number | null
  >(null);
  const destructiveSectionRef = useRef<HTMLElement | null>(null);
  const destructiveInputRef = useRef<HTMLInputElement | null>(null);

  const focusDestructiveMode = () => {
    destructiveSectionRef.current?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
    destructiveInputRef.current?.focus({ preventScroll: true });
  };

  const livePause = useSyncExternalStore(live.agentControl.subscribe, () =>
    live.agentControl.getBoardPause(boardId),
  );
  const paused =
    livePause?.paused ??
    (policy.state?.paused === true ||
      (board?.agentsPausedAt !== undefined && board.agentsPausedAt !== null));
  const pauseReason =
    livePause?.paused === false
      ? null
      : (livePause?.reason ??
        policy.state?.pauseReason ??
        board?.agentsPauseReason ??
        null);

  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t("agentControl.policy.offline")}
      </p>
    );
  }

  if (role !== "ADMIN") {
    return (
      <p
        className="p-4 text-xs text-muted-foreground"
        data-testid="agent-policy-read-only"
      >
        {t("agentControl.policy.adminOnly")}
      </p>
    );
  }

  if (policy.status === "loading") {
    return (
      <SkeletonRegion
        label={t("agentControl.policy.loading")}
        testId="agent-policy-skeleton"
      >
        <div className="space-y-2 p-4" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-lg border p-3">
              <Skeleton width={180} height={12} />
              <Skeleton width={260} height={10} className="mt-2" />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    );
  }

  if (policy.status === "error" || policy.draft === null) {
    return (
      <div className="space-y-2 p-4" data-testid="agent-policy-load-error">
        <p className="text-xs text-[color:var(--agent-tone-danger)]">
          {t("agentControl.policy.loadError")}
        </p>
        <button
          type="button"
          onClick={policy.load}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("agentControl.retry")}
        </button>
      </div>
    );
  }

  const draft = policy.draft;
  const state = policy.state;
  const validation = policy.validation;
  const commandsInvalid =
    validation !== null && validation.maxCommandsPerRun === null;
  const cardsInvalid =
    validation !== null && validation.maxCardsPerRun === null;
  const ttlInvalid =
    validation !== null && validation.approvalTtlMinutes === null;
  const activeTriggerCount = EDITABLE_POLICY_ACTIONS.filter((action) =>
    draft.requireApprovalFor.includes(action),
  ).length;
  const conflict =
    policy.conflicts.length > 0 || policy.error?.kind === "conflict";
  const conflictVersion = policy.error?.version ?? policy.version ?? 0;
  const inlineError =
    policy.error !== null && policy.error.kind !== "conflict"
      ? errorText(policy.error, t)
      : null;
  const footerStatus = policy.saving
    ? t("board.settings.agents.saving")
    : conflict
      ? t("board.settings.agents.conflictShort")
      : policy.error !== null
        ? t("agentControl.error.generic")
        : policy.dirty
          ? t("board.settings.agents.unsaved")
          : t("board.settings.agents.saved");
  const footerTone = policy.saving
    ? "bg-primary"
    : policy.error !== null || conflict
      ? conflict
        ? "bg-warning"
        : "bg-danger"
      : policy.dirty
        ? "bg-warning"
        : "bg-success";
  const secondaryStatus = conflict
    ? t("board.settings.agents.serverAtVersion", { version: conflictVersion })
    : t("board.settings.agents.footerHint");
  const resetDisabled = policy.saving || policy.usingDefaults;

  const save = async () => {
    const outcome = await policy.save();
    if (outcome === "saved") {
      toast.success(t("agentControl.policy.savedToast"));
    }
  };

  const requestReset = () => {
    if (resetDisabled) return;
    setResetConflictVersion(null);
    setResetOpen(true);
  };

  const confirmReset = async () => {
    setResetOpen(false);
    const outcome = await policy.reset();
    if (outcome.kind === "saved") {
      setResetConflictVersion(null);
      toast.success(t("agentControl.policy.resetToast"));
      return;
    }
    if (outcome.kind === "conflict") {
      setResetConflictVersion(outcome.version ?? null);
      setResetOpen(true);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-policy-panel"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[18px] pb-5 pt-4 max-md:px-2.5 max-md:pb-4 max-md:pt-[11px]"
        data-testid="agents-automation-scroll"
      >
        <header className="mb-3 flex items-start gap-3 max-md:flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 font-agent-display text-[17px] font-bold leading-[1.25] tracking-[-0.025em] max-md:text-base">
              {t("board.settings.agents.title")}
            </h2>
            <p className="mt-[3px] max-w-[66ch] text-[11px] leading-[1.5] text-muted-foreground">
              {t("board.settings.agents.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={requestReset}
            disabled={resetDisabled}
            data-testid="agent-policy-reset"
            title={
              policy.usingDefaults
                ? t("board.settings.agents.resetDisabledHint")
                : t("board.settings.agents.resetHint")
            }
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-transparent px-[9px] text-[11px] font-[650] leading-none text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none max-md:h-11 max-md:px-3"
          >
            <RotateCcw className="h-[13px] w-[13px]" aria-hidden />
            {t("board.settings.agents.reset")}
          </button>
        </header>

        <div className="mb-2.5 flex items-start gap-2 rounded-[7px] border border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-primary/[0.06] px-2.5 py-2 text-[11px] leading-[1.45]">
          <Info
            className="mt-px h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden
          />
          <span className="min-w-0">
            <strong className="font-[650] text-foreground">
              {t("board.settings.agents.scopeTitle", {
                board: board?.title ?? "",
              })}
            </strong>{" "}
            {t("board.settings.agents.scopeBody")}
          </span>
        </div>

        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-2 rounded-[7px] border px-[9px] py-[7px] text-[11px] leading-[1.45] text-muted-foreground max-md:px-2 max-md:py-1.5",
            paused
              ? "border-warning/40 bg-warning/10"
              : "border-border bg-[color-mix(in_oklab,var(--surface)_52%,var(--background))]",
          )}
          data-testid="agent-policy-pause"
          data-paused={paused ? "true" : "false"}
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              paused
                ? "bg-warning shadow-[0_0_0_2.5px_color-mix(in_oklab,var(--warning)_14%,transparent)]"
                : "bg-success shadow-[0_0_0_2.5px_color-mix(in_oklab,var(--success)_14%,transparent)]",
            )}
          />
          <b className="font-semibold text-foreground">
            {paused
              ? t("board.settings.agents.paused")
              : t("board.settings.agents.running")}
          </b>
          <span className="min-w-0 truncate">
            {paused
              ? (pauseReason ?? t("board.settings.agents.pausedBody"))
              : t("board.settings.agents.pauseOff")}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
            {onOpenLiveControls ? (
              <button
                type="button"
                onClick={onOpenLiveControls}
                data-testid="agent-policy-open-live"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-[11px] font-semibold leading-[1.45] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
              >
                {t("board.settings.agents.openLive")}
                <ArrowUpRight className="h-[11px] w-[11px]" aria-hidden />
              </button>
            ) : null}
            <span className="flex flex-wrap items-center gap-1 whitespace-nowrap">
              <span data-testid="agent-policy-version">
                {t("agentControl.policy.version", {
                  version: policy.version ?? 0,
                })}
              </span>
              <span aria-hidden>·</span>
              <span>{t("board.settings.agents.adminsOnly")}</span>
            </span>
          </span>
        </div>

        {conflict ? (
          <div
            role="alert"
            data-testid="agents-automation-cas-banner"
            className="mb-3 flex flex-wrap items-start gap-2 rounded-[7px] border border-warning/40 bg-warning/[0.07] px-2.5 py-2 text-[11px] leading-[1.45]"
          >
            <AlertTriangle
              className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-warning)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <b className="mb-0.5 block text-[11px] font-semibold text-foreground">
                {t("board.settings.agents.conflictTitle")}
              </b>
              <span>
                {t("board.settings.agents.conflictBody", {
                  version: conflictVersion,
                })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void policy.reload()}
              disabled={policy.saving}
              data-testid="agents-automation-reload"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-popover px-2 text-[11px] font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:h-11"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              {t("board.settings.agents.reload")}
            </button>
          </div>
        ) : null}

        {policy.conflicts.length > 0 ? (
          <div
            className="mb-3 space-y-2"
            data-testid="agents-automation-conflicts"
          >
            <p className="text-[11px] text-[color:var(--agent-tone-warning)]">
              {t("board.settings.agents.conflictUnresolved")}
            </p>
            {policy.conflicts.map((entry) => (
              <div
                key={entry.field}
                data-testid={`agents-automation-conflict-${entry.field}`}
                className="rounded-[7px] border border-warning/40 bg-warning/[0.05] p-2.5"
              >
                <p className="text-[11px] font-semibold">
                  {t(FIELD_KEYS[entry.field])}
                </p>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => policy.resolveConflict(entry.field, "mine")}
                    data-testid={`agents-automation-conflict-${entry.field}-mine`}
                    className="min-w-0 rounded-md border border-border bg-popover px-2 py-1.5 text-left text-[11px] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                      {t("board.settings.agents.conflictMine")}
                    </span>
                    <span className="mt-0.5 block break-words">
                      {conflictValue(entry.field, entry.local, entry.server, t)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      policy.resolveConflict(entry.field, "server")
                    }
                    data-testid={`agents-automation-conflict-${entry.field}-server`}
                    className="min-w-0 rounded-md border border-border bg-popover px-2 py-1.5 text-left text-[11px] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                      {t("board.settings.agents.conflictServer")}
                    </span>
                    <span className="mt-0.5 block break-words">
                      {conflictValue(entry.field, entry.server, entry.local, t)}
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {inlineError !== null ? (
          <p
            role="alert"
            data-testid="agent-policy-error"
            className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-[color:var(--agent-tone-danger)]"
          >
            {inlineError}
          </p>
        ) : null}

        <div className="mb-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-[1.05fr_1fr]">
          <section
            ref={destructiveSectionRef}
            className="min-w-0 border-t border-border pt-2.5 first:border-t-0 first:pt-0"
            data-testid="agent-policy-destructive-mode"
          >
            <div className="mb-[7px] flex flex-wrap items-baseline gap-[7px]">
              <h3 className="text-xs font-[650] leading-[1.45]">
                {t("agentControl.policy.destructiveTitle")}
              </h3>
              <p className="text-[11px] leading-[1.45] text-muted-foreground">
                {t("board.settings.agents.destructiveDescription")}
              </p>
            </div>
            {(["approval", "deny"] as const).map((value) => {
              const checked = draft.destructive === value;
              return (
                <label
                  key={value}
                  className={cn(
                    "relative mb-1.5 flex cursor-pointer items-start gap-2 rounded-[7px] border px-[9px] py-2 transition-colors motion-reduce:transition-none",
                    checked
                      ? "border-[color-mix(in_oklab,var(--primary)_48%,var(--border))] bg-primary/[0.06]"
                      : "border-border bg-[color-mix(in_oklab,var(--surface)_55%,var(--background))] hover:border-[color-mix(in_oklab,var(--muted-foreground)_27%,var(--border))]",
                  )}
                >
                  <input
                    ref={value === "approval" ? destructiveInputRef : undefined}
                    type="radio"
                    name="agent-destructive"
                    value={value}
                    checked={checked}
                    disabled={policy.saving}
                    onChange={() => policy.setField("destructive", value)}
                    data-testid={`agent-policy-destructive-option-${value}`}
                    className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none disabled:cursor-not-allowed"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-px grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border bg-popover peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                      checked ? "border-primary" : "border-muted-foreground/60",
                    )}
                  >
                    {checked ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-[650] leading-[1.35]">
                      {t(
                        value === "approval"
                          ? "agentControl.policy.destructiveApproval"
                          : "agentControl.policy.destructiveDeny",
                      )}
                    </span>
                    <span className="mt-px block text-[11px] leading-[1.45] text-muted-foreground">
                      {t(
                        value === "approval"
                          ? "board.settings.agents.destructiveApprovalHint"
                          : "board.settings.agents.destructiveDenyHint",
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
            <p className="mb-[11px] mt-[3px] text-[11px] leading-[1.4] text-muted-foreground">
              {t("board.settings.agents.destructiveCovered")}
            </p>
          </section>

          <section className="min-w-0 border-t border-border pt-2.5">
            <div className="mb-[7px] flex flex-wrap items-baseline gap-[7px]">
              <h3 className="text-xs font-[650] leading-[1.45]">
                {t("board.settings.agents.limitsTitle")}
              </h3>
              <p className="text-[11px] leading-[1.45] text-muted-foreground">
                {t("board.settings.agents.limitsDescription")}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-[7px] max-md:grid-cols-2">
              <PolicyNumberField
                id="agent-policy-max-commands"
                testId="agent-policy-max-commands"
                label={t("board.settings.agents.commandsPerRun")}
                value={draft.maxCommandsPerRun}
                onChange={(value) =>
                  policy.setField("maxCommandsPerRun", value)
                }
                min={POLICY_LIMITS.maxCommandsPerRun.min}
                max={POLICY_LIMITS.maxCommandsPerRun.max}
                suffix={t("board.settings.agents.maxCommandsSuffix")}
                invalid={commandsInvalid}
                error={t("board.settings.agents.commandsError")}
                disabled={policy.saving}
              />
              <PolicyNumberField
                id="agent-policy-max-cards"
                testId="agent-policy-max-cards"
                label={t("board.settings.agents.cardsPerRun")}
                value={draft.maxCardsPerRun}
                onChange={(value) => policy.setField("maxCardsPerRun", value)}
                min={POLICY_LIMITS.maxCardsPerRun.min}
                max={POLICY_LIMITS.maxCardsPerRun.max}
                suffix={t("board.settings.agents.maxCardsSuffix")}
                invalid={cardsInvalid}
                error={t("board.settings.agents.cardsError")}
                disabled={policy.saving}
              />
              <PolicyNumberField
                id="agent-policy-ttl"
                testId="agent-policy-ttl"
                label={t("board.settings.agents.approvalTtl")}
                value={draft.approvalTtlMinutes}
                onChange={(value) =>
                  policy.setField("approvalTtlMinutes", value)
                }
                min={POLICY_LIMITS.approvalTtlMinutes.min}
                max={POLICY_LIMITS.approvalTtlMinutes.max}
                suffix={t("board.settings.agents.ttlSuffix")}
                invalid={ttlInvalid}
                error={t("board.settings.agents.ttlError")}
                disabled={policy.saving}
              />
            </div>
            <div className="mt-2.5">
              <p className="mb-[3px] block text-[11px] font-semibold leading-[1.45] text-muted-foreground">
                {t("board.settings.agents.approverRoles")}
              </p>
              <div
                id="agent-policy-approver-roles"
                data-testid="agent-policy-approver-roles"
                role="textbox"
                aria-readonly="true"
                aria-label={t("board.settings.agents.approverRoles")}
                className="flex h-7 w-full cursor-not-allowed items-center justify-between gap-1.5 rounded-[5px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,var(--background))] px-2 text-[11px] leading-[1.2] text-foreground opacity-[0.52] max-md:h-11"
              >
                <span className="min-w-0 truncate">
                  {t("board.settings.agents.approverRolesFixed")}
                </span>
                <ChevronDown
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </div>
              <span className="mt-[3px] block text-[11px] leading-[1.4] text-muted-foreground">
                {t("board.settings.agents.approverRolesHint")}
              </span>
            </div>
          </section>
        </div>

        <section className="mt-0.5 border-t border-border pt-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-[650] leading-[1.45]">
              {t("board.settings.agents.triggersTitle")}
            </h3>
            <span className="text-[11px] leading-[1.45] text-muted-foreground">
              {t("board.settings.agents.triggersMeta", {
                count: activeTriggerCount,
                total: EDITABLE_POLICY_ACTIONS.length,
              })}
            </span>
            <button
              type="button"
              onClick={() => setShowKeys((value) => !value)}
              data-testid="agents-automation-show-keys"
              className="ml-auto inline-flex items-center gap-1 text-[11px] leading-[1.45] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
            >
              <Terminal className="h-[11px] w-[11px]" aria-hidden />
              {showKeys
                ? t("board.settings.agents.hideKeys")
                : t("board.settings.agents.showKeys")}
            </button>
          </div>
          <div
            className="grid grid-cols-1 gap-x-4 sm:grid-cols-2"
            data-testid="agent-policy-require-list"
          >
            {POLICY_TRIGGER_ORDER.map((action) => {
              const covered = isDestructivePolicyAction(action);
              const checked = draft.requireApprovalFor.includes(action);
              const disabled = covered || policy.saving;
              return (
                <div
                  key={action}
                  className={cn(
                    "agent-check-row flex min-h-7 items-center gap-[7px] border-b border-[color-mix(in_oklab,var(--border)_62%,transparent)] py-1 text-[11px] leading-[1.45] last:border-b-0 max-md:min-h-11",
                    covered ? "text-muted-foreground" : "text-foreground",
                    disabled && "is-disabled",
                  )}
                  data-testid={`agent-policy-require-row-${action}`}
                >
                  <label
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-[7px]",
                      disabled ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    <span className="relative inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => policy.toggleAction(action)}
                        data-testid={`agent-policy-require-${action}`}
                        aria-label={t(ACTION_KEYS[action])}
                        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      />
                      <span
                        aria-hidden
                        className="agent-check"
                        data-testid={`agent-policy-check-${action}`}
                      >
                        <Check />
                      </span>
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        covered &&
                          "line-through decoration-muted-foreground/40",
                      )}
                    >
                      {t(ACTION_KEYS[action])}
                    </span>
                  </label>
                  {covered ? (
                    <button
                      type="button"
                      onClick={focusDestructiveMode}
                      data-testid={`agent-policy-covered-${action}`}
                      aria-label={t("board.settings.agents.coveredAction", {
                        action: t(ACTION_KEYS[action]),
                      })}
                      title={t("board.settings.agents.coveredHint")}
                      className="ml-auto shrink-0 cursor-pointer whitespace-nowrap rounded-[3px] border border-border px-1 py-0 text-[11px] leading-[1.45] text-muted-foreground hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("board.settings.agents.covered")}
                    </button>
                  ) : showKeys ? (
                    <code className="ml-auto shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {action}
                    </code>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <div
          className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-[9px] text-[11px] leading-[1.45] text-muted-foreground"
          data-testid="agent-policy-effective-limits"
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              policy.usingDefaults
                ? "bg-success shadow-[0_0_0_2.5px_color-mix(in_oklab,var(--success)_14%,transparent)]"
                : "bg-muted-foreground",
            )}
          />
          <span>
            {policy.usingDefaults
              ? t("board.settings.agents.safeDefaults")
              : t("board.settings.agents.customPolicy")}
          </span>
          <span className="h-[11px] w-px bg-border" aria-hidden />
          <span>
            {t("board.settings.agents.effective", {
              commands: state?.effective.maxCommandsPerRun ?? 0,
              cards: state?.effective.maxCardsPerRun ?? 0,
              ttl: state?.effective.approvalTtlMinutes ?? 0,
            })}
          </span>
        </div>
      </div>

      <footer
        data-testid="agents-automation-footer"
        className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 border-t border-border bg-[color-mix(in_oklab,var(--surface)_82%,var(--background))] px-4 py-[9px] max-md:flex-col max-md:items-stretch max-md:gap-2.5 max-md:px-2.5 max-md:pb-[max(8px,env(safe-area-inset-bottom))] max-md:pt-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] leading-[1.45] text-muted-foreground max-md:w-full">
          <span
            aria-hidden
            className={cn(
              "h-[5px] w-[5px] shrink-0 rounded-full",
              footerTone,
              !policy.saving &&
                (conflict || policy.dirty
                  ? "shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_14%,transparent)]"
                  : "shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_14%,transparent)]"),
            )}
          />
          <span
            aria-live="polite"
            data-testid="agents-automation-dirty"
            className="truncate text-foreground"
          >
            {footerStatus}
          </span>
          <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
          <span className="truncate text-muted-foreground">
            {secondaryStatus}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1.5 max-md:w-full">
          <button
            type="button"
            onClick={policy.discard}
            disabled={!policy.dirty || policy.saving}
            data-testid="agents-automation-discard"
            className="inline-flex h-7 flex-1 items-center justify-center rounded-[6px] border border-transparent px-[9px] text-[11px] font-[650] leading-none text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none max-md:h-11 md:flex-none"
          >
            {t("board.settings.agents.discard")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!policy.canSave}
            data-testid="agent-policy-save"
            className="inline-flex h-7 flex-1 items-center justify-center rounded-[6px] bg-[var(--agent-primary-strong)] px-[9px] text-[11px] font-[650] leading-none text-primary-foreground shadow-[inset_0_1px_rgba(255,255,255,0.16)] transition-colors hover:bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none max-md:h-11 md:flex-none"
          >
            {policy.saving
              ? t("board.settings.agents.saving")
              : t("board.settings.agents.save")}
          </button>
        </div>
      </footer>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) setResetConflictVersion(null);
        }}
        title={
          resetConflictVersion === null
            ? t("agentControl.policy.resetTitle")
            : t("board.settings.agents.resetConflictTitle")
        }
        description={
          resetConflictVersion === null
            ? policy.dirty
              ? t("board.settings.agents.resetDirtyDescription")
              : t("agentControl.policy.resetDescription")
            : t("board.settings.agents.resetConflictDescription", {
                version: resetConflictVersion,
              })
        }
        confirmLabel={t("agentControl.policy.reset")}
        destructive
        onConfirm={() => void confirmReset()}
      />
    </div>
  );
}
