import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleSlash,
  Clock,
  Copy,
  Eye,
  Folder,
  GitBranch,
  Info,
  Link as LinkIcon,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Terminal,
} from "lucide-react";
import type {
  AgentRunKind,
  AgentRunStatus,
  Board,
  BoardAction,
  BoardRole,
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { AgentConfirmDialog } from "./AgentConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { formatDate, formatDateOnly, useHour12, useI18n } from "@/i18n";
import { useBoardLive } from "@/store/board-live";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { StatusBadge, type StatusTone } from "./status-badge";
import {
  RUN_KIND_KEYS,
  RUN_STATUS_KEYS,
  actionSummary,
  entityIdOf,
  groupRunsByDay,
  runLink,
  runTime,
  runTitle,
  type Translate,
} from "./run-model";

type Role = BoardRole | undefined;

const STATUS_TONE: Record<AgentRunStatus, StatusTone> = {
  applied: "ok",
  reverted: "muted",
  failed: "bad",
};

/** One shared run status badge: dot + label, vertically centred. */
export function RunStatusBadge({
  status,
  testId,
  className,
}: {
  status: AgentRunStatus;
  testId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <StatusBadge
      label={t(RUN_STATUS_KEYS[status])}
      tone={STATUS_TONE[status]}
      status={status}
      testId={testId}
      className={className}
    />
  );
}

export function RunKindChip({ kind }: { kind: AgentRunKind }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-[21px] items-center rounded-[4px] border border-border bg-surface/65 px-1.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground">
      {t(RUN_KIND_KEYS[kind])}
    </span>
  );
}

export function RunConflictChip({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-[21px] items-center gap-1 rounded-[4px] border border-warning/36 bg-warning/7 px-1.5 text-[11px] font-semibold whitespace-nowrap text-[color:var(--agent-tone-warning)]">
      <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
      {t("agents.runs.conflictChip", { count })}
    </span>
  );
}

export interface RunListProps {
  rows: readonly RunSummaryDto[];
  selectedId: string | null;
  onSelect: (run: RunSummaryDto) => void;
  now: number;
  variant: "global" | "board";
  testIdPrefix?: string;
  listTestId?: string;
  boardTitle?: (run: RunSummaryDto) => string;
  tokenLabel?: (tokenId: string | null) => string;
  conflicts?: ReadonlyMap<string, number>;
  /** Board Runs uses the mockup's single `Today` group; `/agents` keeps days. */
  groupMode?: "day" | "single";
}

/**
 * One run history list shared by `/agents` (day-grouped, board column) and the
 * board-scoped Agent Control Runs tab (compact with a 286 px rail). Badges sit
 * on the right edge in both variants so the status scans as one column.
 */
export function RunList({
  rows,
  selectedId,
  onSelect,
  now,
  variant,
  testIdPrefix = "agent-run",
  listTestId,
  boardTitle,
  tokenLabel,
  conflicts,
  groupMode = "day",
}: RunListProps) {
  const { t, lang } = useI18n();
  const days = useMemo(() => {
    if (groupMode === "single") {
      return [
        {
          key: "today",
          timestamp: now,
          rows: [...rows],
        },
      ];
    }
    return groupRunsByDay(rows);
  }, [groupMode, now, rows]);
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;

  return (
    <div
      data-testid={listTestId ?? `${testIdPrefix}-list`}
      className={cn(variant === "global" && "border-t border-border")}
    >
      {days.map((day) => {
        const label =
          day.timestamp >= today
            ? t("agents.runs.today")
            : day.timestamp >= yesterday
              ? t("agents.runs.yesterday")
              : formatDateOnly(day.timestamp, lang);
        return (
          <div key={day.key}>
            <div
              className={cn(
                "border-b border-border/70 px-2 text-[11px] font-[650] tracking-[0.06em] uppercase text-muted-foreground",
                variant === "global"
                  ? "pt-2.5 pb-1"
                  : "!px-2.5 pt-[7px] pb-[3px]",
              )}
            >
              {label}
            </div>
            <ul>
              {day.rows.map((run) => {
                const selected = run.id === selectedId;
                const token =
                  run.apiTokenId === null
                    ? t("agentControl.runs.noToken")
                    : (run.tokenName ??
                      tokenLabel?.(run.apiTokenId) ??
                      shortId(run.apiTokenId));
                const conflictCount = conflicts?.get(run.id) ?? 0;
                if (variant === "board") {
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        data-testid={`${testIdPrefix}-row-${run.id}`}
                        data-status={run.status}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => onSelect(run)}
                        className={cn(
                          "block w-full min-h-11 border-b border-border/60 px-2.5 py-[7px] text-left transition-colors hover:bg-hover/48 md:min-h-0",
                          selected &&
                            "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)]",
                        )}
                      >
                        <b className="block truncate text-[11px] leading-[1.4] font-semibold">
                          {runTitle(run, t, token)}
                        </b>
                        <span className="mt-1 block truncate text-[11px] leading-[1.4] text-muted-foreground">
                          {token} ·{" "}
                          {t("agents.runs.commandCount", {
                            count: run.commandCount,
                          })}{" "}
                          · {clockLabel(runTime(run), today, lang, t)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <RunStatusBadge status={run.status} />
                          {conflictCount > 0 ? (
                            <RunConflictChip count={conflictCount} />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      data-testid={`${testIdPrefix}-row-${run.id}`}
                      data-status={run.status}
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onSelect(run)}
                      className={cn(
                        "grid w-full min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border/60 px-2 py-2 text-left transition-colors hover:bg-hover/46 md:min-h-0",
                        selected &&
                          "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)]",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <b className="min-w-0 truncate text-[11.5px] leading-[1.25] font-[650]">
                            {runTitle(run, t, token)}
                          </b>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-[1.4] text-muted-foreground">
                          <span className="truncate">{token}</span>
                          <Dot />
                          <span className="truncate">
                            {boardTitle?.(run) ?? run.boardId}
                          </span>
                          <Dot />
                          <span>
                            {t("agents.runs.commandCount", {
                              count: run.commandCount,
                            })}
                          </span>
                          <Dot />
                          <span className="lowercase">
                            {t(RUN_KIND_KEYS[run.kind])}
                          </span>
                          {conflictCount > 0 ? (
                            <RunConflictChip count={conflictCount} />
                          ) : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end justify-center gap-[3px]">
                        <RunStatusBadge status={run.status} />
                        <span className="flex items-center justify-end gap-1.5 leading-none">
                          <time
                            className="text-[11px] whitespace-nowrap text-muted-foreground"
                            title={formatDate(runTime(run), lang, true)}
                          >
                            {clockLabel(runTime(run), today, lang, t)}
                          </time>
                          <span
                            className="inline-flex h-5 items-center rounded-[4px] border border-border bg-surface/65 px-1.5 font-mono text-[11px] text-muted-foreground max-[760px]:hidden"
                            title={run.id}
                          >
                            {shortId(run.id, 12)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="h-0.5 w-0.5 shrink-0 rounded-full bg-border" />
  );
}

export interface RunDetailProps {
  boardId: string;
  runId: string;
  role: Role;
  boardTitle?: string;
  board?: Board;
  variant: "global" | "board";
  tokenLabel?: (tokenId: string | null) => string;
  sessionLabel?: (sessionId: string | null) => string;
  onClose?: () => void;
  onChanged?: (run: RunDetailDto) => void;
  onPreview?: (runId: string, conflicts: number) => void;
  onOpenSession?: (sessionId: string) => void;
}

/**
 * TASK-179.5 shared run detail. Preview conflicts are readable by any board
 * member; applying is board-ADMIN browser-session only. Pre-images, the diff
 * and the plan hash are ADMIN-only. Rollback copy is conditional: conflicts,
 * retention and missing pre-images can all block it.
 */
export function RunDetail({
  boardId,
  runId,
  role,
  boardTitle,
  board,
  variant,
  tokenLabel,
  sessionLabel,
  onClose,
  onChanged,
  onPreview,
  onOpenSession,
}: RunDetailProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const live = useBoardLive();
  const admin = role === "ADMIN";
  const [now, setNow] = useState(() => Date.now());
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [preview, setPreview] = useState<RevertPreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!isApiEnabled()) return;
    let alive = true;
    // Switching runs must clear the previous detail before the new answer
    // lands; the async result below is the only data source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setDetailError(null);
    setPreview(null);
    setPreviewError(null);
    void (async () => {
      try {
        const loaded = await api.getRun(boardId, runId);
        if (!alive) return;
        setDetail(loaded);
        if (loaded.run.status === "applied" && loaded.run.kind !== "revert") {
          await requestPreview(alive);
        }
      } catch (error) {
        if (alive) setDetailError(error);
      }
    })();
    return () => {
      alive = false;
    };
    // `requestPreview` closes over the current board/run; the effect is the
    // single place that seeds both panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, runId, revision]);

  // A different run starts with a clean action error; retries of the same run
  // keep the last rollback failure visible. This must not depend on
  // `revision`: a failed apply bumps it, and clearing here would swallow the
  // message before the user can read it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on a different run
    setActionError(null);
    setHashCopied(false);
    setLinkCopied(false);
  }, [boardId, runId]);

  // Refresh the timeline day bucket when the fetched run changes and once a
  // minute while the pane stays open, so "Today" cannot drift past midnight.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh the timeline day bucket
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [boardId, runId, revision]);

  // A committed rollback from this or another tab refreshes the detail and
  // its conflict preview; the list hook refreshes independently.
  useEffect(
    () =>
      live.agentControl.subscribeRun((event) => {
        if (event.runId === runId) setRevision((value) => value + 1);
      }),
    [live, runId],
  );

  async function requestPreview(alive = true): Promise<void> {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await api.previewRunRevert(boardId, runId);
      if (alive) {
        setPreview(result);
        onPreview?.(runId, result.conflicts.length);
      }
    } catch (error) {
      if (alive) setPreviewError(error);
    } finally {
      if (alive) setPreviewing(false);
    }
  }

  const applyRevert = async () => {
    if (reverting) return;
    setReverting(true);
    setActionError(null);
    try {
      const updated = await api.revertRun(boardId, runId, {
        dryRun: false,
        commandId: createCommandId(),
      });
      // The explicit revert route can return the new audit run (or a replay
      // of it). The pane is pinned to the original run, so never adopt that
      // detail here: refetch the original id and let the server report
      // `reverted`. `onChanged` refreshes the list.
      setPreview(null);
      setPreviewError(null);
      setConfirmOpen(false);
      toast.success(t("agentControl.runs.revertedToast"));
      setRevision((value) => value + 1);
      onChanged?.(updated);
    } catch (error) {
      setActionError(runErrorText(error, t));
      setConfirmOpen(false);
      setRevision((value) => value + 1);
    } finally {
      setReverting(false);
    }
  };

  const copyHash = async () => {
    if (detail?.run.planHash == null) return;
    await copyText(detail.run.planHash);
    setHashCopied(true);
    toast.success(t("agents.runs.hashCopied"));
  };

  const copyLink = async () => {
    await copyText(absoluteUrl(runLink(boardId, runId)));
    setLinkCopied(true);
    toast.success(t("agents.runs.linkCopied"));
  };

  if (!isApiEnabled()) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground">
        {t("agentControl.runs.offline")}
      </p>
    );
  }

  if (detailError !== null) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center"
        data-testid="agent-run-detail-error"
      >
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
          <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="text-[13px] font-semibold text-foreground">
          {errorStatus(detailError) === 404
            ? t("agents.runs.detailNotFound")
            : t("agentControl.runs.detailError")}
        </p>
        <p className="max-w-[32ch] text-[11px] leading-[1.5] text-muted-foreground">
          {t("agents.runs.detailErrorBody")}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="agent-run-detail-retry"
          onClick={() => setRevision((value) => value + 1)}
          className="max-md:min-h-11"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("agentControl.retry")}
        </Button>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div
        className="space-y-2 p-4"
        data-testid="agent-run-detail-skeleton"
        aria-hidden
      >
        <Skeleton width={220} height={14} />
        <Skeleton width={300} height={10} />
        <Skeleton width={240} height={10} />
      </div>
    );
  }

  const run = detail.run;
  const today = startOfDay(now);
  const conflicts = preview?.conflicts ?? [];
  const rollbackEligible = run.status === "applied" && run.kind !== "revert";
  // `run_expired` means the API has no stored commands/pre-images for this
  // run. That is usually retention, but a synthetic/partially imported run
  // looks the same; the UI must not claim a retention window it cannot prove.
  const previewUnavailable = errorCodeOf(previewError) === "run_expired";
  const storedCommands = detail.commands.length;
  const missingCommands = storedCommands === 0 && run.commandCount > 0;
  const commandsAside =
    run.status === "failed"
      ? t("agents.runs.commandsStoredOnly", { count: storedCommands })
      : storedCommands === run.commandCount
        ? t("agents.runs.appliedCount", { count: run.commandCount })
        : t("agents.runs.commandsStored", {
            stored: storedCommands,
            total: run.commandCount,
          });
  const duration = Math.max(0, run.appliedAt - run.createdAt);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="agent-run-detail"
      data-run-id={run.id}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2">
        {onClose !== undefined ? (
          <button
            type="button"
            onClick={onClose}
            data-testid="agent-run-detail-back"
            aria-label={t("agents.runs.backToList")}
            className={cn(
              "mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover",
              variant === "global" ? "min-[1061px]:hidden" : "md:hidden",
            )}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {variant === "global" ? (
            <p className="m-0 mb-0.5 text-[11px] font-[650] tracking-[0.07em] text-muted-foreground uppercase">
              {t("agents.runs.detailEyebrow", {
                board: boardTitle ?? run.boardId,
              })}
            </p>
          ) : null}
          <h2 className="m-0 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em] break-words">
            {runTitle(
              run,
              t,
              run.apiTokenId === null
                ? undefined
                : (run.tokenName ?? tokenLabel?.(run.apiTokenId) ?? undefined),
            )}
          </h2>
          {variant === "board" ? (
            <p
              className="mt-0.5 font-mono text-[11px] text-muted-foreground"
              title={run.id}
            >
              {shortId(run.id, 12)} ·{" "}
              <span className="lowercase">{t(RUN_KIND_KEYS[run.kind])}</span> ·{" "}
              {t("agents.runs.commandCount", { count: run.commandCount })} ·{" "}
              {clockLabel(runTime(run), today, lang, t)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4">
        {run.status === "failed" ? (
          <Banner
            tone="bad"
            icon={<AlertTriangle aria-hidden />}
            testId="agent-run-failed-banner"
          >
            <strong className="font-[650]">
              {t("agents.runs.failedTitle")}
            </strong>{" "}
            {t("agents.runs.failedBody")}
          </Banner>
        ) : null}
        {run.status === "reverted" ? (
          <Banner
            tone="info"
            icon={<RotateCcw aria-hidden />}
            testId="agent-run-reverted-banner"
          >
            <strong className="font-[650]">
              {t("agents.runs.revertedTitle")}
            </strong>{" "}
            {run.revertedAt === null
              ? t("agents.runs.revertedBody")
              : t("agents.runs.revertedAtBody", {
                  time: formatRunMoment(run.revertedAt, lang, hour12, t, now),
                })}
          </Banner>
        ) : null}
        {rollbackEligible && conflicts.length > 0 ? (
          <Banner
            tone="warn"
            icon={<AlertTriangle aria-hidden />}
            testId="agent-run-conflict-banner"
          >
            <strong className="font-[650]">
              {t("agents.runs.conflictTitle", { count: conflicts.length })}
            </strong>{" "}
            {t("agents.runs.conflictBody")}
          </Banner>
        ) : null}
        {!admin ? (
          <div
            data-testid="agent-run-admin-only-note"
            className="mb-2.5 flex items-start gap-2 rounded-[7px] border border-border bg-muted/30 px-2.5 py-2 text-[11px] leading-[1.45] text-muted-foreground"
          >
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t("agents.runs.adminOnlyNote")}</span>
          </div>
        ) : null}

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <RunStatusBadge status={run.status} testId="agent-run-status" />
          <RunKindChip kind={run.kind} />
          <span className="inline-flex h-[21px] items-center rounded-[4px] border border-border bg-surface/65 px-1.5 text-[11px] font-semibold text-muted-foreground">
            {t("agents.runs.commandCount", { count: run.commandCount })}
          </span>
          <Link
            to={routes.board(boardId)}
            data-testid="agent-run-board-chip"
            className="inline-flex h-[21px] max-w-full items-center rounded-[4px] border border-border bg-surface/65 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{boardTitle ?? boardId}</span>
          </Link>
        </div>

        <Section
          title={t("agentControl.runs.attribution")}
          icon={<GitBranch aria-hidden />}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <MetaField label={t("agents.runs.actor")}>
              {run.actorName ?? run.actorId}
            </MetaField>
            <MetaField label={t("agentControl.runs.token")}>
              {run.tokenName ??
                tokenLabel?.(run.apiTokenId) ??
                run.apiTokenId ??
                t("agentControl.runs.noToken")}
            </MetaField>
            <MetaField label={t("agentControl.runs.session")}>
              {run.sessionName ??
                sessionLabel?.(run.agentSessionId) ??
                run.agentSessionId ??
                t("agentControl.runs.noSession")}
            </MetaField>
            <MetaField label={t("agents.runs.duration")}>
              {formatDuration(duration)}
            </MetaField>
            <MetaField label={t("agents.runs.runId")}>
              <span className="font-mono" title={run.id}>
                {shortId(run.id, 12)}
              </span>
            </MetaField>
            <MetaField label={t("agentControl.runs.approval")}>
              {run.approvalId ?? t("agents.runs.notApprovalGated")}
            </MetaField>
          </div>
        </Section>

        <Section
          title={t("agentControl.runs.timeline")}
          icon={<Clock aria-hidden />}
          testId="agent-run-timeline"
        >
          <ul className="space-y-0">
            <TimelineItem
              tone="warn"
              label={t("agentControl.runs.created")}
              value={formatRunMoment(run.createdAt, lang, hour12, t, now)}
            />
            {run.status !== "failed" ? (
              <TimelineItem
                tone="applied"
                label={t("agentControl.runs.applied")}
                value={formatRunMoment(run.appliedAt, lang, hour12, t, now)}
              />
            ) : null}
            {run.revertedAt !== null ? (
              <TimelineItem
                tone="reverted"
                label={t("agentControl.runs.reverted")}
                value={formatRunMoment(run.revertedAt, lang, hour12, t, now)}
                testId="agent-run-reverted-at"
              />
            ) : null}
          </ul>
        </Section>

        <Section
          title={t("agents.runs.commandsTitle")}
          icon={<Terminal aria-hidden />}
          aside={commandsAside}
        >
          {storedCommands === 0 ? (
            <p
              className="text-[11px] leading-[1.45] text-muted-foreground"
              data-testid="agent-run-commands-missing"
            >
              {missingCommands
                ? t("agents.runs.commandsMissingBody", {
                    count: run.commandCount,
                  })
                : t("agentControl.runs.noCommands")}
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="agent-run-commands">
              {detail.commands.map((command) => {
                const preimage = detail.preimages[command.commandId ?? ""];
                return (
                  <li
                    key={command.seq}
                    data-testid={`agent-run-command-${command.seq}`}
                    className="rounded-md border border-border bg-background/30 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <code className="rounded-[4px] bg-muted px-1.5 py-0.5 text-[11px]">
                        {command.action.type}
                      </code>
                      <span className="min-w-0 truncate">
                        {actionSummary(command.action, board)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {command.actorType === "agent"
                        ? t("agentControl.runs.actorAgent")
                        : t("agentControl.runs.actorHuman")}{" "}
                      · {command.agentName ?? command.actorId}
                    </p>
                    {admin ? (
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <DiffBox
                          label={t("agents.runs.before")}
                          value={
                            preimage === undefined
                              ? "—"
                              : (preimageLabel(preimage) ?? "—")
                          }
                        />
                        <DiffBox
                          label={t("agents.runs.after")}
                          value={afterLabel(command.action, preimage, t)}
                        />
                      </div>
                    ) : null}
                    {admin && preimage !== undefined ? (
                      <details
                        data-testid="agent-run-preimage"
                        className="mt-1.5"
                      >
                        <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                          <ChevronRight className="h-2.5 w-2.5" aria-hidden />
                          {t("agentControl.runs.preimage")}
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-1.5 text-[11px]">
                          {JSON.stringify(preimage, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {admin && Object.keys(detail.preimages).length > 0 ? (
            <details
              className="group mt-1.5 overflow-hidden rounded-md border border-border bg-background/30"
              data-testid="agent-run-preimages"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-[11px] w-[11px] transition-transform group-open:rotate-90"
                  aria-hidden
                />
                {t("agents.runs.technicalPreimages", {
                  count: Object.keys(detail.preimages).length,
                })}
              </summary>
              <pre className="m-0 max-h-64 overflow-auto border-t border-border p-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-words text-muted-foreground">
                {JSON.stringify(detail.preimages, null, 2)}
              </pre>
            </details>
          ) : null}
        </Section>

        <Section
          title={t("agentControl.runs.rollback")}
          icon={<RotateCcw aria-hidden />}
          testId="agent-run-revert"
        >
          {rollbackEligible ? (
            previewing && preview === null ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t("agentControl.runs.previewing")}
              </p>
            ) : previewError !== null ? (
              <div
                className="space-y-1.5 rounded-md border border-warning/35 bg-warning/6 px-2.5 py-2 text-[11px] text-[color:var(--agent-tone-warning)]"
                role="alert"
                data-testid={
                  previewUnavailable
                    ? "agent-run-preview-unavailable"
                    : "agent-run-preview-error"
                }
              >
                <p>{runErrorText(previewError, t)}</p>
                {previewUnavailable ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void requestPreview()}
                    disabled={previewing}
                    className="min-h-9 max-md:min-h-11"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    {t("agentControl.runs.refreshPreview")}
                  </Button>
                )}
              </div>
            ) : preview !== null ? (
              <div
                data-testid="agent-run-rollback-card"
                className={cn(
                  "space-y-2 rounded-[7px] border px-2.5 py-2",
                  preview.canRevert
                    ? "border-[color-mix(in_oklab,var(--success)_30%,var(--border))] bg-success/5"
                    : "border-warning/35 bg-warning/6",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {preview.canRevert ? (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-success)]"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-warning)]"
                      aria-hidden
                    />
                  )}
                  <b className="text-[11.5px] font-[650] text-foreground">
                    {conflicts.length > 0
                      ? t("agents.runs.rollbackConflict")
                      : t("agents.runs.rollbackPreview")}
                  </b>
                </div>
                <p
                  data-testid="agent-run-can-revert"
                  data-can-revert={preview.canRevert ? "true" : "false"}
                  className="m-0 text-[11px] leading-[1.45] text-foreground"
                >
                  {preview.canRevert
                    ? t("agents.runs.previewReady", { count: storedCommands })
                    : t("agentControl.runs.cannotRevert")}
                </p>
                {conflicts.length > 0 ? (
                  <ul data-testid="agent-run-conflicts" className="space-y-1">
                    {conflicts.map((conflict) => (
                      <li
                        key={conflict.touch}
                        className="rounded-[4px] border border-warning/35 bg-warning/6 px-2 py-1.5 text-[11px] text-[color:var(--agent-tone-warning)]"
                      >
                        <span className="font-mono">{conflict.touch}</span> ·{" "}
                        {conflict.reason} · {conflict.expectedVersion} →{" "}
                        {conflict.currentVersion}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="agent-run-preview"
                    disabled={previewing}
                    onClick={() => void requestPreview()}
                    className="max-md:min-h-11"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {t("agents.runs.previewAgain")}
                  </Button>
                  {admin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="agent-run-revert-apply"
                      disabled={!preview.canRevert || reverting}
                      title={
                        preview.canRevert
                          ? undefined
                          : conflicts.length > 0
                            ? t("agents.runs.resolveConflictFirst")
                            : t("agentControl.runs.cannotRevert")
                      }
                      onClick={() => setConfirmOpen(true)}
                      className="border-danger/50 text-[color:var(--agent-tone-danger)] hover:bg-danger/10 disabled:opacity-40 max-md:min-h-11"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      {!preview.canRevert
                        ? t("agents.runs.revertBlocked")
                        : t("agentControl.runs.revert")}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {t("agentControl.runs.adminOnly")}
                    </span>
                  )}
                </div>
              </div>
            ) : null
          ) : run.status === "reverted" ? (
            <p
              data-testid="agent-run-already-reverted"
              className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
            >
              <Check
                className="mt-px h-3 w-3 shrink-0 text-[color:var(--agent-tone-success)]"
                aria-hidden
              />
              {t("agentControl.runs.alreadyReverted")}
            </p>
          ) : run.kind === "revert" ? (
            <p
              data-testid="agent-run-revert-run-note"
              className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
            >
              <CircleSlash className="mt-px h-3 w-3 shrink-0" aria-hidden />
              {t("agents.runs.revertRunNoRollback")}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CircleSlash className="mt-px h-3 w-3 shrink-0" aria-hidden />
              {t("agents.runs.nothingToRollback")}
            </p>
          )}

          {actionError !== null ? (
            <p
              role="alert"
              data-testid="agent-run-action-error"
              className="mt-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-[11px] text-[color:var(--agent-tone-danger)]"
            >
              {actionError}
            </p>
          ) : null}
        </Section>

        {admin && run.status === "applied" && run.planHash !== null ? (
          <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-[5px] border border-border bg-background/30 px-1.5 py-1">
            <code
              data-testid="agent-run-plan-hash"
              title={run.planHash}
              className="min-w-0 flex-1 overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap text-muted-foreground"
            >
              {t("agents.runs.planHash", {
                hash: run.planHash.slice(0, 34),
              })}
            </code>
            <button
              type="button"
              onClick={() => void copyHash()}
              aria-label={t("agents.runs.copyHash")}
              data-testid="agent-run-copy-hash"
              className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
            >
              {hashCopied ? (
                <Check
                  className="h-3 w-3 text-[color:var(--agent-tone-success)]"
                  aria-hidden
                />
              ) : (
                <Copy className="h-3 w-3 opacity-70" aria-hidden />
              )}
            </button>
          </div>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Link
            to={routes.agentControl(boardId, "runs")}
            data-testid="agent-run-open-board"
            className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-[4px] border border-border bg-surface/58 px-1.5 text-[11px] text-muted-foreground hover:text-foreground max-md:min-h-11"
          >
            <Folder className="h-2.5 w-2.5" aria-hidden />
            {t("agents.runs.openBoard")}
          </Link>
          {run.agentSessionId !== null ? (
            onOpenSession !== undefined ? (
              <button
                type="button"
                data-testid="agent-run-open-session"
                onClick={() => onOpenSession(run.agentSessionId ?? "")}
                className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-[4px] border border-border bg-surface/58 px-1.5 text-[11px] text-muted-foreground hover:text-foreground max-md:min-h-11"
              >
                <Activity className="h-2.5 w-2.5" aria-hidden />
                {t("agents.runs.openSession")}
              </button>
            ) : (
              <Link
                to={`${routes.agents}?${new URLSearchParams({
                  section: "sessions",
                  board: boardId,
                  session: run.agentSessionId,
                }).toString()}`}
                data-testid="agent-run-open-session"
                className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-[4px] border border-border bg-surface/58 px-1.5 text-[11px] text-muted-foreground hover:text-foreground max-md:min-h-11"
              >
                <Activity className="h-2.5 w-2.5" aria-hidden />
                {t("agents.runs.openSession")}
              </Link>
            )
          ) : null}
          <button
            type="button"
            onClick={() => void copyLink()}
            data-testid="agent-run-copy-link"
            data-copy-url={runLink(boardId, runId)}
            className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-border bg-surface/58 px-1.5 text-[11px] text-muted-foreground hover:text-foreground max-md:min-h-11"
          >
            {linkCopied ? (
              <Check
                className="h-2.5 w-2.5 text-[color:var(--agent-tone-success)]"
                aria-hidden
              />
            ) : (
              <LinkIcon className="h-2.5 w-2.5" aria-hidden />
            )}
            {t("agents.runs.copyLink")}
          </button>
        </div>
      </div>

      {variant === "global" ? (
        <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-[color-mix(in_oklab,var(--surface)_84%,var(--background))] px-3.5 py-2.5 text-[11px] leading-[1.45] text-muted-foreground">
          <p className="m-0 flex items-start gap-1.5">
            <Info
              className="mt-[2px] h-[11px] w-[11px] shrink-0 text-[color:var(--agent-tone-success)]"
              aria-hidden
            />
            <span className="min-w-0">
              {admin
                ? t("agents.runs.footerAdmin")
                : t("agents.runs.footerMember")}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={routes.agentControl(boardId, "runs")}
              data-testid="agent-run-footer-open-board"
              className="inline-flex h-8 min-h-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[11px] text-[11.5px] leading-none font-[650] text-foreground hover:bg-hover max-md:min-h-11"
            >
              {t("agents.runs.openBoard")}
            </Link>
            <button
              type="button"
              onClick={() => void copyLink()}
              data-testid="agent-run-footer-copy-link"
              className="inline-flex h-8 min-h-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-[11px] text-[11.5px] leading-none font-[650] text-muted-foreground hover:bg-hover hover:text-foreground max-md:min-h-11"
            >
              {linkCopied ? (
                <Check
                  className="h-[13px] w-[13px] text-[color:var(--agent-tone-success)]"
                  aria-hidden
                />
              ) : (
                <LinkIcon className="h-[13px] w-[13px]" aria-hidden />
              )}
              {t("agents.runs.copyLink")}
            </button>
          </div>
        </footer>
      ) : null}

      <AgentConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        icon={RotateCcw}
        tone="danger"
        title={t("agents.runs.confirmTitle")}
        description={t("agents.runs.confirmDescription")}
        confirmLabel={t("agents.runs.confirmApply")}
        onConfirm={() => void applyRevert()}
        busy={reverting}
        testId="run-revert-dialog"
        confirmTestId="run-revert-confirm"
      >
        <div className="mt-2.5 rounded-r-[5px] border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-2.5 py-2 text-[11px] leading-[1.5] text-foreground">
          <b className="font-[650]">
            {t("agents.runs.confirmCount", { count: detail.commands.length })}
          </b>{" "}
          {runTitle(run, t, run.tokenName ?? undefined)}.{" "}
          {t("agents.runs.confirmNoConflicts")}
        </div>
      </AgentConfirmDialog>
    </div>
  );
}

function Banner({
  tone,
  icon,
  testId,
  children,
}: {
  tone: "bad" | "warn" | "info";
  icon: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "mb-2.5 flex items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45] [&_svg]:mt-px [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0",
        tone === "bad" &&
          "border-danger/35 bg-danger/6 [&_svg]:text-[color:var(--agent-tone-danger)]",
        tone === "warn" &&
          "border-warning/35 bg-warning/6 [&_svg]:text-[color:var(--agent-tone-warning)]",
        tone === "info" &&
          "border-primary/30 bg-primary/6 [&_svg]:text-[color:var(--agent-tone-primary)]",
      )}
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function Section({
  title,
  icon,
  aside,
  testId,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  aside?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="mt-2.5 border-t border-border/70 pt-2.5 first:border-t-0 first:pt-0"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
          {icon}
        </span>
        <h3 className="m-0 text-[11px] font-[650] tracking-[0.03em] text-foreground">
          {title}
        </h3>
        {aside !== undefined ? (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="block min-w-0 text-[11px] leading-[1.4] font-medium break-words text-foreground">
        {children}
      </span>
    </div>
  );
}

function TimelineItem({
  tone,
  label,
  value,
  testId,
}: {
  tone: "warn" | "applied" | "reverted";
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-[7px] pb-2.5 last:pb-0 before:absolute before:top-[13px] before:bottom-0 before:left-[6px] before:w-px before:bg-border last:before:hidden"
    >
      <span className="relative z-[1] mt-px grid h-[13px] w-[13px] place-items-center rounded-full border border-border bg-surface">
        <span
          aria-hidden
          className={cn(
            "h-[5px] w-[5px] rounded-full",
            tone === "warn"
              ? "bg-warning"
              : tone === "applied"
                ? "bg-success"
                : "bg-muted-foreground",
          )}
        />
      </span>
      <span>
        <b className="block text-[11px] font-semibold leading-[1.4] text-foreground">
          {label}
        </b>
        <span className="mt-px block text-[11px] leading-[1.4] text-muted-foreground">
          {value}
        </span>
      </span>
    </li>
  );
}

function DiffBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[4px] border border-border/60 px-1.5 py-1">
      <span className="block text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <b className="mt-px block truncate text-[11px] font-semibold text-foreground">
        {value}
      </b>
    </div>
  );
}

function errorCodeOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (body === null || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function conflictCountOf(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body === null || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return null;
  const conflicts = (details as { conflicts?: unknown }).conflicts;
  return Array.isArray(conflicts) ? conflicts.length : null;
}

function runErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  switch (errorCodeOf(error)) {
    case "pat_forbidden":
      return t("agentControl.runs.error.patForbidden");
    case "run_conflict": {
      const count = conflictCountOf(error);
      return count === null
        ? t("agentControl.runs.error.conflict")
        : t("agentControl.runs.error.conflictCount", { count });
    }
    case "run_expired":
      return t("agentControl.runs.error.expired");
    case "scope_denied":
      return t("agentControl.runs.error.adminOnly");
    default:
      break;
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

function preimageLabel(preimage: unknown): string | null {
  if (typeof preimage !== "object" || preimage === null) return null;
  const entities = (preimage as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return null;
  for (const entity of [...entities].reverse()) {
    if (typeof entity !== "object" || entity === null) continue;
    const snapshot = (entity as { snapshot?: unknown }).snapshot;
    if (typeof snapshot !== "object" || snapshot === null) continue;
    const record = snapshot as Record<string, unknown>;
    const label = record.title ?? record.name ?? record.text ?? record.id;
    if (typeof label === "string" && label !== "") return label;
  }
  return null;
}

function afterLabel(
  action: BoardAction,
  preimage: unknown,
  t: Translate,
): string {
  const type = action.type;
  if (type.startsWith("ADD_") || type.startsWith("CREATE_")) {
    return t("agents.runs.after.created");
  }
  if (type.startsWith("DELETE_") || type.startsWith("ARCHIVE_")) {
    return t("agents.runs.after.deleted");
  }
  if (type.startsWith("MOVE_")) return t("agents.runs.after.moved");
  if (type.startsWith("RENAME_")) return t("agents.runs.after.renamed");
  if (type.startsWith("UPDATE_")) return t("agents.runs.after.updated");
  const entity = entityIdOf(action);
  if (entity !== null) {
    const record =
      typeof preimage === "object" && preimage !== null
        ? (preimage as { entities?: unknown }).entities
        : undefined;
    if (Array.isArray(record)) {
      for (const entry of record) {
        if (typeof entry !== "object" || entry === null) continue;
        const postVersion = (entry as { postVersion?: unknown }).postVersion;
        if (typeof postVersion === "number") return `v${postVersion}`;
      }
    }
    return entity.id;
  }
  return "—";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The mockup's timeline wording: `Today, 5:24:12 PM`, `Yesterday, …`, or the
 * locale date for older runs. A raw `11/15/26, 7:15 PM` is not the visual
 * language of the agents surface.
 */
function formatRunMoment(
  timestamp: number,
  lang: string,
  hour12: boolean,
  t: Translate,
  now: number,
): string {
  const locale = lang.startsWith("ru") ? "ru-RU" : "en-US";
  const time = new Date(timestamp).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  });
  const day = startOfDay(timestamp);
  const today = startOfDay(now);
  if (day === today) return `${t("agents.runs.today")}, ${time}`;
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (day === yesterdayDate.getTime()) {
    return `${t("agents.runs.yesterday")}, ${time}`;
  }
  return formatDate(timestamp, lang, hour12);
}

function clockLabel(
  timestamp: number,
  today: number,
  lang: string,
  t: Translate,
): string {
  if (timestamp >= today) {
    return new Date(timestamp).toLocaleTimeString(
      lang === "ru" ? "ru-RU" : "en-US",
      {
        hour: "numeric",
        minute: "2-digit",
      },
    );
  }
  if (timestamp >= today - 24 * 60 * 60 * 1000)
    return t("agents.runs.yesterday");
  return formatDateOnly(timestamp, lang);
}

function shortId(id: string, length = 8): string {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).href;
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* fall through to the selection-based fallback */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function createCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `revert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
