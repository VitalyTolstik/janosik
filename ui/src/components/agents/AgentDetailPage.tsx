import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  Pause,
  Play,
  Square,
} from "lucide-react";

import type { AgentSessionStatus } from "@janosik/shared";

import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { AgentAttribution } from "./AgentAttribution";
import {
  AgentLastSeen,
  AgentPauseBadge,
  AgentStaleBadge,
  AgentStatusBadge,
} from "./agents-ui";
import {
  AgentActionDialog,
  type AgentSessionAction,
} from "./AgentActionDialog";
import {
  groupAgents,
  isLiveSession,
  lastSeenAt,
  shortId,
  type AgentSessionRow,
} from "./agent-model";
import { useAgentSessions } from "./use-agent-sessions";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { routes } from "@/routes";

/**
 * One agent (a personal API token) and every session it has on the caller's
 * boards (TASK-166.13). Pausing, resuming and ending are board-ADMIN actions;
 * a MEMBER/VIEWER sees the same evidence read-only, and an agent token cannot
 * drive the control plane at all.
 */
export function AgentDetailPage() {
  const { tokenId = "" } = useParams();
  const { t } = useI18n();
  const state = useAgentSessions();
  const rows = useMemo(
    () => state.rows.filter((row) => row.apiTokenId === tokenId),
    [state.rows, tokenId],
  );
  const group = useMemo(() => groupAgents(rows)[0], [rows]);
  const [pending, setPending] = useState<{
    action: AgentSessionAction;
    row: AgentSessionRow;
  } | null>(null);

  const canControl = (row: AgentSessionRow): boolean =>
    !state.isAgentToken && row.boardRole === "ADMIN" && isLiveSession(row);

  if (state.loading) {
    return (
      <main className="flex min-h-0 flex-1 flex-col px-4 pt-4 pb-4 sm:px-6">
        <SkeletonRegion
          label={t("agents.loading")}
          testId="agent-detail-loading"
          contentClassName="space-y-3"
        >
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="card" height={140} />
          <Skeleton variant="card" height={180} />
        </SkeletonRegion>
      </main>
    );
  }

  if (state.error && state.rows.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div
          className="max-w-md rounded-xl border border-danger/40 bg-danger/10 p-4 text-center"
          data-testid="agent-detail-error"
          role="alert"
        >
          <p className="text-sm font-medium text-danger">
            {t("agents.error.title")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => state.reload()}
            data-testid="agent-detail-retry"
          >
            {t("agents.retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (group === undefined) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div
          className="flex max-w-md flex-col items-center gap-3 text-center"
          data-testid="agent-not-found"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
            <Bot className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("agents.notFound.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("agents.notFound.body")}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={routes.agents} data-testid="agent-back">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t("agents.back")}
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const live = group.rows.filter(isLiveSession);
  const boards = uniqueBoards(group.rows);
  const canControlAny = group.rows.some((row) => canControl(row));
  const readOnly = !canControlAny && live.length > 0;

  return (
    <main
      className="flex min-h-0 w-full flex-1 flex-col px-4 pt-4 pb-4 sm:px-6"
      data-testid="agent-detail-page"
    >
      <div className="mb-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to={routes.agents} data-testid="agent-back">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t("agents.back")}
          </Link>
        </Button>
      </div>

      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary">
            <Bot className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              className="truncate text-xl font-semibold tracking-[-0.025em] text-foreground"
              data-testid="agent-detail-name"
            >
              {group.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <AgentAttribution apiTokenId={group.tokenId} compact />
              <span>
                {t("agents.owner")}:{" "}
                <span className="font-mono">
                  {shortId(group.rows[0]?.userId ?? "")}
                </span>
              </span>
              <span>
                {t("agents.boards")}: {boards.length}
              </span>
              <AgentLastSeen
                at={group.lastSeen}
                prefix={t("agents.lastSeen")}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {group.liveCount > 0 ? (
            <span className="rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[11px] font-medium text-success">
              {t("agents.liveCount", { count: group.liveCount })}
            </span>
          ) : null}
          {group.waitingCount > 0 ? (
            <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning">
              {t("agents.waitingCount", { count: group.waitingCount })}
            </span>
          ) : null}
          {group.rows.some((row) => row.stale) ? <AgentStaleBadge /> : null}
        </div>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={t("agents.stats.sessions")}
          value={group.rows.length}
          testId="agent-detail-stat-sessions"
        />
        <Stat
          label={t("agents.stats.live")}
          value={live.length}
          testId="agent-detail-stat-live"
          tone="success"
        />
        <Stat
          label={t("agents.stats.boards")}
          value={boards.length}
          testId="agent-detail-stat-boards"
        />
        <Stat
          label={t("agents.stats.waiting")}
          value={group.waitingCount}
          testId="agent-detail-stat-waiting"
          tone="warning"
        />
      </div>

      {state.isAgentToken ? (
        <p
          className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          data-testid="agent-token-notice"
        >
          {t("agents.agentOnly")}
        </p>
      ) : readOnly ? (
        <p
          className="mb-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground"
          data-testid="agent-read-only-notice"
        >
          {t("agents.readOnly")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-2" data-testid="agent-session-list">
          {group.rows
            .slice()
            .sort(
              (a, b) =>
                Number(isLiveSession(b)) - Number(isLiveSession(a)) ||
                lastSeenAt(b) - lastSeenAt(a),
            )
            .map((row) => (
              <SessionCard
                key={row.id}
                row={row}
                canControl={canControl(row)}
                onAction={(action) => setPending({ action, row })}
              />
            ))}
        </ul>
      </div>

      {pending !== null ? (
        <AgentActionDialog
          action={pending.action}
          row={pending.row}
          onClose={() => setPending(null)}
          onSaved={(session) => state.replaceSession(session)}
        />
      ) : null}
    </main>
  );
}

function SessionCard({
  row,
  canControl,
  onAction,
}: {
  row: AgentSessionRow;
  canControl: boolean;
  onAction: (action: AgentSessionAction) => void;
}) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const live = isLiveSession(row);
  const sessionPaused = row.pausedAt !== null;
  const showPause = canControl && !row.paused;
  const showResume = canControl && sessionPaused;
  const boardHref =
    row.currentCardId === null
      ? routes.board(row.boardId)
      : `${routes.board(row.boardId)}?card=${encodeURIComponent(row.currentCardId)}`;

  return (
    <li
      className="rounded-xl border border-border bg-card/75 p-3.5 sm:p-4"
      data-testid="agent-session"
      data-session-id={row.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={routes.board(row.boardId)}
              className="truncate text-sm font-semibold text-foreground hover:underline"
            >
              {row.boardTitle}
            </Link>
            <AgentStatusBadge status={row.status} />
            {row.stale && !isTerminal(row.status) ? <AgentStaleBadge /> : null}
            {row.paused ? (
              <AgentPauseBadge
                scope={row.pauseScope ?? "session"}
                title={row.pausedReason ?? undefined}
              />
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[row.name, row.clientName, row.model]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || row.id}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canControl ? (
            <>
              {showPause ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAction("pause")}
                  data-testid="agent-session-pause"
                >
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  {t("agents.action.pause")}
                </Button>
              ) : null}
              {showResume ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAction("resume")}
                  data-testid="agent-session-resume"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {t("agents.action.resume")}
                </Button>
              ) : null}
              {live ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => onAction("end")}
                  data-testid="agent-session-end"
                >
                  <Square className="h-3.5 w-3.5" aria-hidden />
                  {t("agents.action.end")}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={boardHref}
              data-testid="agent-session-open-board"
              title={t("agents.openBoard")}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">
                {t("agents.openBoard")}
              </span>
            </Link>
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Field label={t("agents.heartbeat")}>
          <span className="flex flex-wrap items-center gap-1.5">
            <AgentLastSeen at={row.lastHeartbeatAt} />
            <span className="text-muted-foreground/60">
              ({formatDate(row.lastHeartbeatAt, lang, hour12)})
            </span>
          </span>
        </Field>
        <Field label={t("agents.started")}>
          {formatDate(row.startedAt, lang, hour12)}
        </Field>
        <Field label={t("agents.ended")}>
          {row.endedAt === null ? "—" : formatDate(row.endedAt, lang, hour12)}
        </Field>
        <Field label={t("agents.currentCard")}>
          {row.currentCardId === null ? (
            "—"
          ) : (
            <Link
              to={boardHref}
              className="truncate text-primary hover:underline"
              title={row.cardTitle ?? row.currentCardId}
            >
              {row.cardTitle ?? shortId(row.currentCardId)}
            </Link>
          )}
        </Field>
        <Field label={t("agents.currentRun")}>
          {row.currentRunId === null ? (
            "—"
          ) : (
            <span className="font-mono" title={row.currentRunId}>
              {shortId(row.currentRunId)}
            </span>
          )}
        </Field>
        <Field label={t("agents.session")}>
          <span className="font-mono" title={row.id}>
            {shortId(row.id)}
          </span>
        </Field>
        <Field label={t("agents.pauseReason")}>{row.pausedReason ?? "—"}</Field>
        <Field label={t("agents.endReason")}>{row.endReason ?? "—"}</Field>
      </dl>

      {row.summary ? (
        <p className="mt-3 rounded-lg border border-border/70 bg-background/40 px-2.5 py-2 text-xs leading-5 text-foreground/80">
          {row.summary}
        </p>
      ) : null}

      <div className="mt-2.5">
        <AgentAttribution
          apiTokenId={row.apiTokenId}
          agentSessionId={row.id}
          runId={row.currentRunId}
          agentName={row.tokenName}
        />
      </div>
    </li>
  );
}

function isTerminal(status: AgentSessionStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 truncate text-foreground/85">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  testId,
  tone = "default",
}: {
  label: string;
  value: number;
  testId: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-card/70 px-3 py-2">
      <div
        data-testid={testId}
        className={
          tone === "success"
            ? "text-xl font-semibold tabular-nums text-success"
            : tone === "warning"
              ? "text-xl font-semibold tabular-nums text-warning"
              : "text-xl font-semibold tabular-nums text-foreground"
        }
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function uniqueBoards(rows: AgentSessionRow[]): string[] {
  return [...new Set(rows.map((row) => row.boardId))];
}
