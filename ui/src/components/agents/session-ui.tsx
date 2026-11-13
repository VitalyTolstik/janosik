/* eslint-disable react-refresh/only-export-components -- shared session rows and their pure grouping helpers live together */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Clock,
  Folder,
  History,
  KeyRound,
  Lock,
  Pause,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";
import type { AgentSessionDto, AgentSessionStatus } from "@janosik/shared";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { boardColor } from "@/utils/board-color";
import { AgentPauseBadge } from "./agents-ui";
import { StatusBadge, type StatusTone } from "./status-badge";
import {
  AgentActionDialog,
  type AgentSessionAction,
} from "./AgentActionDialog";
import {
  agentLabel,
  agentStatusTone,
  compactAge,
  heartbeatAge,
  isTerminalStatus,
  runNumber,
  shortId,
  type AgentGroupMode,
  type AgentSessionRow,
} from "./agent-model";

const STATUS_TONE: Record<ReturnType<typeof agentStatusTone>, StatusTone> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
  primary: "primary",
  muted: "muted",
};

/** The real lifecycle status, never `stale` and never `paused`. */
export function SessionStatusPill({
  status,
  className,
  short = false,
}: {
  status: AgentSessionStatus;
  className?: string;
  short?: boolean;
}) {
  const { t } = useI18n();
  return (
    <StatusBadge
      data-lifecycle="true"
      label={t(
        short ? `agents.statusShort.${status}` : `agents.status.${status}`,
      )}
      tone={STATUS_TONE[agentStatusTone(status)]}
      status={status}
      testId={`agent-status-${status}`}
      className={className}
    />
  );
}

/**
 * Heartbeat is a liveness signal, not a lifecycle status. A stale session
 * keeps its real status and shows `No heartbeat · 6m` beside it.
 */
export function HeartbeatText({
  session,
  now,
  className,
  withIcon = true,
}: {
  session: AgentSessionDto;
  now: number;
  className?: string;
  withIcon?: boolean;
}) {
  const { t } = useI18n();
  const age = compactAge(heartbeatAge(session, now));
  return (
    <span
      data-testid="agent-heartbeat"
      data-stale={session.stale ? "true" : "false"}
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap",
        session.stale
          ? "text-[color:var(--agent-tone-warning)]"
          : "text-muted-foreground",
        className,
      )}
    >
      {withIcon ? (
        session.stale ? (
          <Clock className="h-[11px] w-[11px] shrink-0" aria-hidden />
        ) : (
          <Activity className="h-[11px] w-[11px] shrink-0" aria-hidden />
        )
      ) : null}
      <span>
        {session.stale
          ? t("agents.heartbeat.noHeartbeat", { age })
          : t("agents.heartbeat.ago", { age })}
      </span>
    </span>
  );
}

/**
 * Token settings are owner-only. A board admin can watch another member's
 * session, but must not be sent into an Account surface that cannot show
 * the key; the non-owner state is plain text, not a ghost button.
 */
export function TokenSettingsLink({
  isOwn,
  onOpen,
  className,
  testId = "agent-token-settings",
}: {
  isOwn: boolean;
  onOpen: () => void;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  if (!isOwn) {
    return (
      <span
        data-testid={`${testId}-readonly`}
        title={t("agents.tokenSettings.ownerOnlyHint")}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <Lock className="h-[10px] w-[10px] shrink-0" aria-hidden />
        {t("agents.tokenSettings.ownerOnly")}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className={cn(
        "inline-flex min-h-11 items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground hover:underline min-[761px]:min-h-6",
        className,
      )}
    >
      {t("agents.tokenSettings.open")}
      <ArrowUpRight className="h-[10px] w-[10px]" aria-hidden />
    </button>
  );
}

export interface SessionGroup {
  key: string;
  title: string;
  rows: AgentSessionRow[];
  boardId?: string;
  tokenId?: string;
  isOwnToken?: boolean;
  pending?: number;
}

/** Group the filtered rows by board (default) or by agent token. */
export function groupSessionRows(
  rows: AgentSessionRow[],
  mode: AgentGroupMode,
): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const row of rows) {
    const key = mode === "board" ? row.boardId : row.apiTokenId;
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.rows.push(row);
      if (mode === "token" && row.isOwnToken) existing.isOwnToken = true;
      continue;
    }
    groups.set(key, {
      key,
      title: mode === "board" ? row.boardTitle : agentLabel(row),
      rows: [row],
      ...(mode === "board"
        ? { boardId: row.boardId }
        : {
            tokenId: row.apiTokenId,
            isOwnToken: row.isOwnToken,
          }),
    });
  }
  return [...groups.values()];
}

function groupMeta(group: SessionGroup) {
  const stale = group.rows.filter((row) => row.stale).length;
  return { count: group.rows.length, stale };
}

function SessionGroupHeader({
  group,
  mode,
  staleBoardIds,
  onOpenTokens,
}: {
  group: SessionGroup;
  mode: AgentGroupMode;
  staleBoardIds: string[];
  onOpenTokens: () => void;
}) {
  const { t } = useI18n();
  const { count, stale } = groupMeta(group);
  const staleBoard =
    group.boardId !== undefined && staleBoardIds.includes(group.boardId);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border-soft px-1.5 pt-1.5 pb-1"
      data-testid={
        mode === "board"
          ? `agents-board-group-${group.boardId}`
          : `agents-token-group-${group.tokenId}`
      }
    >
      {mode === "board" ? (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-[2px]",
            boardColor(group.boardId ?? ""),
          )}
        />
      ) : (
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] border border-border bg-surface text-muted-foreground">
          <Bot className="h-3 w-3" aria-hidden />
        </span>
      )}
      <b className="min-w-0 truncate text-[11.5px] font-[650]">{group.title}</b>
      {mode === "token" && group.tokenId !== undefined ? (
        <span className="max-w-full truncate rounded-[3px] border border-border bg-background px-1 py-px font-mono text-[11px] text-muted-foreground">
          {shortId(group.tokenId, 12)}
        </span>
      ) : null}
      {mode === "board" && (group.pending ?? 0) > 0 ? (
        <span className="rounded-[4px] border border-warning/26 bg-warning/12 px-1 py-px text-[11px] font-[650] text-[color:var(--agent-tone-warning)]">
          {t("agents.groups.pending", { count: group.pending ?? 0 })}
        </span>
      ) : null}
      <span
        data-testid={`agents-group-meta-${group.key}`}
        className={cn(
          "text-[11px] text-muted-foreground",
          mode === "board" && "ml-auto",
        )}
      >
        {t("agents.groups.sessions", { count })}
        {stale > 0
          ? ` · ${t("agents.groups.noHeartbeat", { count: stale })}`
          : ""}
      </span>
      {staleBoard ? (
        <span className="text-[11px] text-[color:var(--agent-tone-warning)]">
          {t("agents.shell.staleData")}
        </span>
      ) : null}
      {mode === "token" ? (
        <span className="ml-auto">
          <TokenSettingsLink
            isOwn={group.isOwnToken === true}
            onOpen={onOpenTokens}
            testId={`agents-token-settings-${group.tokenId ?? "unknown"}`}
          />
        </span>
      ) : null}
    </div>
  );
}

/** Header row shared by both group modes (hidden on narrow screens). */
export function SessionTableHeader() {
  const { t } = useI18n();
  return (
    <div
      aria-hidden="true"
      data-testid="agent-session-table-head"
      className="hidden min-h-[26px] items-center gap-2 border-b border-border px-1.5 py-1 text-[11px] font-[650] tracking-[0.05em] text-muted-foreground uppercase min-[761px]:grid min-[761px]:grid-cols-[minmax(132px,1.45fr)_minmax(128px,1.25fr)_120px_96px] min-[1181px]:grid-cols-[minmax(140px,1.4fr)_minmax(140px,1.35fr)_minmax(108px,1.1fr)_120px_96px] min-[1181px]:gap-2.5"
    >
      <span>{t("agents.table.agent")}</span>
      <span>{t("agents.table.session")}</span>
      <span className="hidden min-[1181px]:block">
        {t("agents.table.card")}
      </span>
      <span>{t("agents.table.heartbeat")}</span>
      <span>{t("agents.table.status")}</span>
    </div>
  );
}

const ROW_GRID =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-border-soft px-1.5 py-2 text-left transition-colors last:border-b-0 hover:bg-hover/46 min-[761px]:grid-cols-[minmax(132px,1.45fr)_minmax(128px,1.25fr)_120px_96px] min-[761px]:gap-2 min-[1181px]:grid-cols-[minmax(140px,1.4fr)_minmax(140px,1.35fr)_minmax(108px,1.1fr)_120px_96px] min-[1181px]:gap-2.5";

export function SessionRow({
  row,
  mode,
  selected,
  now,
  onSelect,
}: {
  row: AgentSessionRow;
  mode: AgentGroupMode;
  selected: boolean;
  now: number;
  onSelect: (row: AgentSessionRow) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-testid={`agent-session-row-${row.id}`}
      data-session-id={row.id}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={t("agents.table.rowLabel", {
        agent: agentLabel(row),
        session: row.name ?? shortId(row.id),
        board: row.boardTitle,
      })}
      onClick={() => onSelect(row)}
      className={cn(
        ROW_GRID,
        selected && "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)]",
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5 max-[760px]:col-start-1 max-[760px]:row-start-1">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] border border-border bg-surface text-muted-foreground">
          <Bot className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[11.5px] font-[650] leading-[1.35]">
            {agentLabel(row)}
          </b>
          <span className="mt-px block truncate text-[11px] leading-[1.35] text-muted-foreground">
            {[row.clientName, row.model]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || shortId(row.apiTokenId)}
          </span>
        </span>
      </span>
      <span className="min-w-0 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:text-right">
        <b className="block truncate text-[11px] font-[550] leading-[1.35] max-[760px]:text-[11px] max-[760px]:font-medium max-[760px]:text-muted-foreground">
          {row.name ?? shortId(row.id)}
        </b>
        <span className="mt-px block truncate text-[11px] text-muted-foreground max-[760px]:hidden">
          {mode === "board" ? row.boardTitle : shortId(row.apiTokenId)}
        </span>
      </span>
      <span className="hidden min-w-0 min-[1181px]:block max-[760px]:col-start-1 max-[760px]:row-start-2 max-[760px]:block">
        <b className="block truncate text-[11px] font-[550] leading-[1.35]">
          {row.currentCardId === null
            ? "—"
            : (row.cardTitle ?? shortId(row.currentCardId))}
        </b>
        <span className="mt-px block truncate text-[11px] text-muted-foreground">
          {row.currentRunId === null
            ? t("agents.noCurrentRun")
            : t("agents.runHash", { id: runNumber(row.currentRunId) })}
        </span>
      </span>
      <span className="min-w-0 max-[760px]:col-start-1 max-[760px]:row-start-3">
        <HeartbeatText session={row} now={now} />
      </span>
      <span className="flex flex-wrap items-center gap-1 max-[760px]:col-start-2 max-[760px]:row-start-2 max-[760px]:justify-end">
        <SessionStatusPill status={row.status} short />
        {row.paused ? (
          <AgentPauseBadge
            scope={row.pauseScope ?? "session"}
            title={row.pausedReason ?? undefined}
            className="h-[18px] px-1 text-[11px]"
          />
        ) : null}
      </span>
    </button>
  );
}

export function SessionGroupList({
  groups,
  mode,
  selectedId,
  now,
  staleBoardIds,
  onSelect,
  onOpenTokens,
}: {
  groups: SessionGroup[];
  mode: AgentGroupMode;
  selectedId: string | null;
  now: number;
  staleBoardIds: string[];
  onSelect: (row: AgentSessionRow) => void;
  onOpenTokens: () => void;
}) {
  return (
    <div data-testid="agents-session-list" className="min-w-0">
      {groups.map((group) => (
        <div key={group.key} className="mt-2.5 first:mt-0">
          <SessionGroupHeader
            group={group}
            mode={mode}
            staleBoardIds={staleBoardIds}
            onOpenTokens={onOpenTokens}
          />
          <SessionTableHeader />
          <div className="border-t border-border">
            {group.rows.map((row) => (
              <SessionRow
                key={row.id}
                row={row}
                mode={mode}
                selected={selectedId === row.id}
                now={now}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function terminalKey(
  status: AgentSessionStatus,
): "completed" | "failed" | "cancelled" {
  return status === "failed"
    ? "failed"
    : status === "cancelled"
      ? "cancelled"
      : "completed";
}

function sessionHint(
  row: AgentSessionRow,
  now: number,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (isTerminalStatus(row.status)) {
    return t(`agents.detail.terminal.${terminalKey(row.status)}`);
  }
  if (row.stale) {
    return t("agents.detail.staleHint", {
      age: compactAge(heartbeatAge(row, now)),
      status: t(`agents.status.${row.status}`),
    });
  }
  if (row.paused) {
    return t("agents.detail.pausedHint");
  }
  if (row.status === "waiting_approval") {
    return t("agents.detail.waitingHint");
  }
  if (row.status === "idle") {
    return t("agents.detail.idleHint");
  }
  return t("agents.detail.activeHint");
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
      <span className="mb-0.5 block text-[11px] tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="block min-w-0 text-[11px] leading-[1.4] font-medium break-words text-foreground">
        {children}
      </span>
    </div>
  );
}

function SectionHead({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <h3 className="m-0 text-[11px] font-[650] tracking-[0.03em] text-foreground">
        {title}
      </h3>
    </div>
  );
}

function DetailEmpty({
  missingId,
  onClose,
}: {
  missingId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("agents.detail.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover min-[1061px]:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="m-0 mb-0.5 text-[11px] font-[650] tracking-[0.07em] text-muted-foreground uppercase">
            {t("agents.shell.detailEyebrow")}
          </p>
          <h2
            data-testid={
              missingId === null ? undefined : "agents-session-detail-missing"
            }
            className="m-0 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em]"
          >
            {missingId === null
              ? t("agents.shell.noSelection")
              : t("agents.detail.missingTitle")}
          </h2>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
          {missingId === null ? (
            <KeyRound className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
          )}
        </span>
        <p className="text-[13px] font-semibold text-foreground">
          {missingId === null
            ? t("agents.shell.noSessionsToInspect")
            : t("agents.detail.missingTitle")}
        </p>
        <p className="max-w-[30ch] text-[11.5px] leading-[1.55] text-muted-foreground">
          {missingId === null
            ? t("agents.shell.noSessionsBody")
            : t("agents.detail.missingBody")}
        </p>
        {missingId !== null ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("agents.detail.clearSelection")}
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function SessionDetail({
  row,
  missingId,
  now,
  isAgentToken,
  staleBoardIds,
  onClose,
  onSaved,
  onOpenTokens,
}: {
  row: AgentSessionRow | undefined;
  missingId: string | null;
  now: number;
  isAgentToken: boolean;
  staleBoardIds: string[];
  onClose: () => void;
  onSaved: (session: AgentSessionDto) => void;
  onOpenTokens: () => void;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<AgentSessionAction | null>(null);

  if (row === undefined) {
    return <DetailEmpty missingId={missingId} onClose={onClose} />;
  }

  const terminal = isTerminalStatus(row.status);
  const canControl =
    !terminal &&
    !isAgentToken &&
    row.boardRole === "ADMIN" &&
    !staleBoardIds.includes(row.boardId);
  const sessionPaused = row.pauseScope === "session";
  const pausedByOtherScope =
    row.paused && row.pauseScope !== null && row.pauseScope !== "session";
  const boardHref =
    row.currentCardId === null
      ? routes.board(row.boardId)
      : `${routes.board(row.boardId)}?card=${encodeURIComponent(row.currentCardId)}`;
  const runHref =
    row.currentRunId === null
      ? null
      : `${routes.agents}?${new URLSearchParams({
          section: "runs",
          board: row.boardId,
          run: row.currentRunId,
        }).toString()}`;
  const bannerTone = terminal
    ? "border-border bg-muted/35"
    : row.stale || row.paused
      ? "border-warning/34 bg-warning/6"
      : "border-primary/30 bg-primary/6";
  const BannerIcon = terminal
    ? row.status === "failed"
      ? AlertTriangle
      : ShieldCheck
    : row.stale
      ? Clock
      : row.paused
        ? Pause
        : Activity;

  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2">
        <button
          type="button"
          onClick={onClose}
          data-testid="agents-session-detail-back"
          aria-label={t("agents.detail.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover min-[1061px]:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="m-0 mb-0.5 text-[11px] font-[650] tracking-[0.07em] text-muted-foreground uppercase">
            {t("agents.detail.sessionEyebrow", { board: row.boardTitle })}
          </p>
          <h2 className="m-0 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em] break-words">
            {agentLabel(row)}
          </h2>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4">
        <div
          role="status"
          data-testid="agents-session-detail-hint"
          className={cn(
            "mb-2.5 flex items-start gap-2 rounded-[7px] border px-2.5 py-2 text-[11px] leading-[1.45]",
            bannerTone,
          )}
        >
          <BannerIcon
            className={cn(
              "mt-px h-3.5 w-3.5 shrink-0",
              terminal
                ? "text-muted-foreground"
                : row.stale || row.paused
                  ? "text-[color:var(--agent-tone-warning)]"
                  : "text-[color:var(--agent-tone-primary)]",
            )}
            aria-hidden
          />
          <span className="min-w-0">{sessionHint(row, now, t)}</span>
        </div>

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <SessionStatusPill status={row.status} />
          <HeartbeatText session={row} now={now} />
          <Link
            to={routes.board(row.boardId)}
            className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-[4px] border border-border px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Folder className="h-[10px] w-[10px]" aria-hidden />
            <span className="truncate">{row.boardTitle}</span>
          </Link>
          {row.paused ? (
            <AgentPauseBadge
              scope={row.pauseScope ?? "session"}
              title={row.pausedReason ?? undefined}
            />
          ) : null}
          {staleBoardIds.includes(row.boardId) ? (
            <span className="text-[11px] text-[color:var(--agent-tone-warning)]">
              {t("agents.shell.staleData")}
            </span>
          ) : null}
        </div>

        {row.pausedReason ? (
          <div className="mb-2.5 flex items-start gap-2 rounded-[7px] border border-warning/34 bg-warning/6 px-2.5 py-2 text-[11px] leading-[1.45]">
            <Pause
              className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--agent-tone-warning)]"
              aria-hidden
            />
            <span>
              <strong className="font-[650] text-foreground">
                {t("agentControl.pause.reasonValue")}:
              </strong>{" "}
              {row.pausedReason}
            </span>
          </div>
        ) : null}

        <section className="border-b border-border-soft py-2.5">
          <SectionHead
            icon={<Activity className="h-3 w-3" aria-hidden />}
            title={t("agents.detail.sessionSection")}
          />
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <MetaField label={t("agents.detail.agent")}>
              {agentLabel(row)}
            </MetaField>
            <MetaField label={t("agents.detail.clientModel")}>
              {[row.clientName, row.model]
                .filter((value): value is string => Boolean(value))
                .join(" · ") || "—"}
            </MetaField>
            <MetaField label={t("agents.detail.token")}>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {shortId(row.apiTokenId, 12)}
                </span>
                <TokenSettingsLink
                  isOwn={row.isOwnToken}
                  onOpen={onOpenTokens}
                  testId="agents-session-token-settings"
                />
              </span>
            </MetaField>
            <MetaField label={t("agents.started")}>
              {t("agents.startedAgo", {
                age: compactAge(Math.max(0, now - row.startedAt)),
              })}
            </MetaField>
            <MetaField label={t("agents.currentCard")}>
              {row.currentCardId === null ? (
                "—"
              ) : (
                <Link
                  to={boardHref}
                  className="truncate text-[color:var(--agent-tone-primary)] hover:underline"
                  title={row.cardTitle ?? row.currentCardId}
                >
                  {row.cardTitle ?? shortId(row.currentCardId)}
                </Link>
              )}
            </MetaField>
            <MetaField label={t("agents.currentRun")}>
              {runHref === null ? (
                "—"
              ) : (
                <Link
                  to={runHref}
                  className="truncate text-[color:var(--agent-tone-primary)] hover:underline"
                  title={row.currentRunId ?? undefined}
                >
                  {t("agents.runHash", {
                    id: runNumber(row.currentRunId ?? ""),
                  })}
                </Link>
              )}
            </MetaField>
          </div>
        </section>

        <section className="border-b border-border-soft py-2.5">
          <SectionHead
            icon={<History className="h-3 w-3" aria-hidden />}
            title={t("agents.detail.currentWork")}
          />
          <div className="flex flex-wrap gap-1.5">
            {row.currentCardId === null ? (
              <span className="text-[11px] text-muted-foreground">
                {t("agents.detail.noCurrentCard")}
              </span>
            ) : (
              <Link
                to={boardHref}
                className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-border bg-surface/45 px-1.5 text-[11px] text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
              >
                <Folder className="h-[10px] w-[10px]" aria-hidden />
                {row.cardTitle ?? shortId(row.currentCardId)}
              </Link>
            )}
            {runHref !== null ? (
              <Link
                to={runHref}
                className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-border bg-surface/45 px-1.5 text-[11px] text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
              >
                <History className="h-[10px] w-[10px]" aria-hidden />
                {t("agents.runHash", {
                  id: runNumber(row.currentRunId ?? ""),
                })}
              </Link>
            ) : null}
          </div>
        </section>

        <section className="py-2.5">
          <SectionHead
            icon={<ShieldCheck className="h-3 w-3" aria-hidden />}
            title={t("agents.detail.pauseSemantics")}
          />
          <p className="m-0 text-[11px] leading-[1.5] text-muted-foreground">
            {t("agents.detail.claims")}
          </p>
        </section>
      </div>

      <div className="shrink-0 border-t border-border bg-surface/84 px-3.5 py-2.5">
        <p
          data-testid={
            !terminal && !canControl ? "agents-session-read-only" : undefined
          }
          className="m-0 mb-2 flex items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground"
        >
          {terminal ? (
            <ShieldCheck
              className="mt-0.5 h-[11px] w-[11px] shrink-0 text-[color:var(--agent-tone-success)]"
              aria-hidden
            />
          ) : canControl ? (
            <ShieldCheck
              className="mt-0.5 h-[11px] w-[11px] shrink-0 text-[color:var(--agent-tone-success)]"
              aria-hidden
            />
          ) : (
            <Lock className="mt-0.5 h-[11px] w-[11px] shrink-0" aria-hidden />
          )}
          <span>
            {terminal
              ? t(`agents.detail.terminalFooter.${terminalKey(row.status)}`)
              : canControl
                ? t("agents.detail.adminFooter")
                : t("agents.detail.readOnlyFooter")}
          </span>
        </p>
        {terminal ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="min-h-11 flex-1 md:min-h-8"
            >
              <Link to={boardHref} data-testid="agents-session-open-board">
                <Folder className="h-3.5 w-3.5" aria-hidden />
                {t("agents.openBoard")}
              </Link>
            </Button>
            {canControl && sessionPaused ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 flex-1 md:min-h-8"
                data-testid="agents-session-resume"
                onClick={() => setAction("resume")}
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                {t("agents.action.resume")}
              </Button>
            ) : null}
            {canControl && !row.paused ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 flex-1 md:min-h-8"
                data-testid="agents-session-pause"
                onClick={() => setAction("pause")}
              >
                <Pause className="h-3.5 w-3.5" aria-hidden />
                {t("agents.action.pause")}
              </Button>
            ) : null}
            {canControl ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 flex-1 border-danger/44 bg-danger/5 text-[color:var(--agent-tone-danger)] hover:bg-danger/10 hover:text-[color:var(--agent-tone-danger)] md:min-h-8"
                data-testid="agents-session-end"
                onClick={() => setAction("end")}
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
                {t("agents.action.end")}
              </Button>
            ) : null}
            {pausedByOtherScope ? (
              <span className="basis-full text-[11px] text-muted-foreground">
                {t("agents.detail.pausedByScope", {
                  scope: t(`agents.pause.scope.${row.pauseScope ?? "board"}`),
                })}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {action !== null ? (
        <AgentActionDialog
          action={action}
          row={row}
          onClose={() => setAction(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
