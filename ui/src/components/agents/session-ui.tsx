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
  GitCommit,
  History,
  KeyRound,
  Lock,
  Pause,
  Play,
  ShieldCheck,
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
  isSessionPaused,
  isTerminalStatus,
  runNumber,
  sessionDisplayStatus,
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
 * The status a session actually reads as. A human pause replaces the stored
 * lifecycle (`idle`) with `Paused`, matching the mockup's single status pill;
 * board/token pauses stay separate chips so they do not rewrite every row.
 */
export function SessionStatePill({
  session,
  className,
  short = false,
}: {
  session: Pick<AgentSessionRow, "status" | "pausedAt" | "stale">;
  className?: string;
  short?: boolean;
}) {
  const { t } = useI18n();
  const display = sessionDisplayStatus(session);
  if (display === "paused") {
    return (
      <StatusBadge
        data-lifecycle="false"
        label={t("agents.status.paused")}
        tone="warn"
        status="paused"
        testId="agent-status-paused"
        className={className}
      />
    );
  }
  if (display === "stale") {
    return (
      <StatusBadge
        data-lifecycle="false"
        label={t("agents.status.stale")}
        tone="warn"
        status="stale"
        testId="agent-status-stale"
        className={className}
      />
    );
  }
  return (
    <StatusBadge
      data-lifecycle="true"
      label={t(
        short ? `agents.statusShort.${display}` : `agents.status.${display}`,
      )}
      tone={STATUS_TONE[agentStatusTone(display)]}
      status={display}
      testId={`agent-status-${display}`}
      className={className}
    />
  );
}

/**
 * Heartbeat is a liveness signal, not a lifecycle status. User decision: the
 * row shows the relative time only (`12s ago`, `7m ago`); a stale session
 * keeps its real status and gets the warning colour plus a clock icon instead
 * of a "No heartbeat ·" prefix.
 */
export function HeartbeatText({
  session,
  now,
  className,
  withIcon = true,
  muted = false,
}: {
  session: AgentSessionDto;
  now: number;
  className?: string;
  withIcon?: boolean;
  /** Keep the relative time muted even when the session is stale. */
  muted?: boolean;
}) {
  const { t } = useI18n();
  const age = compactAge(heartbeatAge(session, now));
  return (
    <span
      data-testid="agent-heartbeat"
      data-stale={session.stale ? "true" : "false"}
      className={cn(
        "inline-flex items-center gap-[5px] text-[11px] leading-[1.45] whitespace-nowrap",
        muted
          ? "text-muted-foreground"
          : session.stale
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
      <span>{t("agents.heartbeat.ago", { age })}</span>
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
}: {
  group: SessionGroup;
  mode: AgentGroupMode;
  staleBoardIds: string[];
}) {
  const { t } = useI18n();
  const { count, stale } = groupMeta(group);
  const staleBoard =
    group.boardId !== undefined && staleBoardIds.includes(group.boardId);
  return (
    <div
      className="flex flex-wrap items-center gap-[7px] border-b border-border-soft px-2 pt-0 pb-[5px]"
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
      {mode === "board" && (group.pending ?? 0) > 0 ? (
        <span className="inline-flex h-[21px] items-center rounded-[4px] border border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-warning/7 px-1.5 text-[11px] font-semibold text-[color:var(--warning)]">
          {t("agents.groups.pending", { count: group.pending ?? 0 })}
        </span>
      ) : null}
      {staleBoard ? (
        <span className="inline-flex h-[21px] items-center rounded-[4px] border border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-warning/7 px-1.5 text-[11px] font-semibold text-[color:var(--warning)]">
          {t("agents.shell.staleData")}
        </span>
      ) : null}
      <span
        data-testid={`agents-group-meta-${group.key}`}
        className="ml-auto text-[11px] text-muted-foreground"
      >
        {t("agents.groups.sessions", { count })}
        {` · ${t("agents.groups.noHeartbeat", { count: stale })}`}
      </span>
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
      className="hidden min-h-[26px] items-center gap-2 border-b border-border px-2 py-[5px] text-[11px] font-[650] tracking-[0.04em] text-[color:color-mix(in_oklab,var(--muted-foreground)_76%,transparent)] uppercase min-[761px]:grid min-[761px]:grid-cols-[minmax(128px,1.35fr)_minmax(120px,1.2fr)_82px_100px] min-[1181px]:grid-cols-[minmax(140px,1.4fr)_minmax(140px,1.35fr)_minmax(108px,1.1fr)_82px_104px] min-[1181px]:gap-2.5"
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
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-border-soft px-2 py-1.5 text-left transition-colors last:border-b-0 hover:bg-hover/46 max-[760px]:px-1.5 max-[760px]:py-2 min-[761px]:min-h-[47px] min-[761px]:grid-cols-[minmax(128px,1.35fr)_minmax(120px,1.2fr)_82px_100px] min-[761px]:gap-2 min-[1181px]:grid-cols-[minmax(140px,1.4fr)_minmax(140px,1.35fr)_minmax(108px,1.1fr)_82px_104px] min-[1181px]:gap-2.5";

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
        selected &&
          "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/6",
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5 max-[760px]:col-start-1 max-[760px]:row-start-1">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] border border-border bg-surface text-muted-foreground">
          <Bot className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[11.5px] leading-[1.35] font-[650] text-muted-foreground">
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
      <span className="flex flex-nowrap items-center gap-1 max-[760px]:col-start-2 max-[760px]:row-start-2 max-[760px]:justify-end">
        <SessionStatePill session={row} short />
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
}: {
  groups: SessionGroup[];
  mode: AgentGroupMode;
  selectedId: string | null;
  now: number;
  staleBoardIds: string[];
  onSelect: (row: AgentSessionRow) => void;
}) {
  return (
    <div data-testid="agents-session-list" className="min-w-0">
      {groups.map((group) => (
        <div key={group.key} className="mt-2.5 first:mt-0">
          <SessionGroupHeader
            group={group}
            mode={mode}
            staleBoardIds={staleBoardIds}
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

function sessionHint(
  row: AgentSessionRow,
  now: number,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (isTerminalStatus(row.status)) {
    return t("agents.detail.endedHint");
  }
  // A human pause is the explanation for a missing heartbeat. Check it before
  // `stale` so a paused session never reports its stored `Idle` lifecycle.
  if (isSessionPaused(row)) {
    return row.stale
      ? t("agents.detail.pausedStaleHint", {
          age: compactAge(heartbeatAge(row, now)),
        })
      : t("agents.detail.pausedHint");
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
      <span className="mb-0.5 block text-[11px] tracking-[0.04em] text-[color:color-mix(in_oklab,var(--muted-foreground)_78%,transparent)] uppercase">
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
      <h3 className="m-0 text-[11.5px] font-[650] tracking-[0.03em] text-foreground">
        {title}
      </h3>
    </div>
  );
}

const DETAIL_BUTTON_CLASS =
  "h-7 min-h-0 gap-[6px] rounded-[6px] px-[9px] py-0 text-[11px] leading-none font-[650]";

/** Prototype `.btn`: 32 px, 11.5 px / 650, 6 px gap, 11 px side padding. */
const FOOTER_BUTTON_CLASS =
  "min-h-11 min-w-0 flex-1 gap-1.5 rounded-[6px] bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-[11px] text-[11.5px] leading-none font-[650] md:min-h-8";

function DetailEmpty({
  missingId,
  onClose,
  onOpenTokens,
}: {
  missingId: string | null;
  onClose: () => void;
  onOpenTokens: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2 max-[760px]:px-3 max-[760px]:pt-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("agents.detail.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover min-[1061px]:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="m-0 mb-[3px] text-[11px] font-[650] tracking-[0.07em] text-muted-foreground uppercase">
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
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-7 text-center">
        <span className="mb-0.5 grid h-[34px] w-[34px] place-items-center rounded-lg border border-border bg-surface text-muted-foreground">
          {missingId === null ? (
            <KeyRound className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
          )}
        </span>
        <p className="m-0 text-[12px] leading-[1.45] font-[650] text-foreground">
          {missingId === null
            ? t("agents.shell.noSessionsToInspect")
            : t("agents.detail.missingTitle")}
        </p>
        <p className="m-0 max-w-[30ch] text-[11px] leading-[1.5] text-muted-foreground">
          {missingId === null
            ? t("agents.shell.noSessionsBody")
            : t("agents.detail.missingBody")}
        </p>
        {missingId === null ? (
          <Button
            onClick={onOpenTokens}
            data-testid="agents-detail-create-key"
            className={`${DETAIL_BUTTON_CLASS} !bg-[var(--agent-primary-strong)] hover:!bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)]`}
          >
            {t("agents.shell.createKey")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            data-testid="agents-clear-selection"
            className={`${DETAIL_BUTTON_CLASS} !bg-[color-mix(in_oklab,var(--surface)_65%,transparent)]`}
          >
            {t("agents.detail.clearSelection")}
          </Button>
        )}
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
    return (
      <DetailEmpty
        missingId={missingId}
        onClose={onClose}
        onOpenTokens={onOpenTokens}
      />
    );
  }

  const terminal = isTerminalStatus(row.status);
  const canControl =
    !terminal &&
    !isAgentToken &&
    row.boardRole === "ADMIN" &&
    !staleBoardIds.includes(row.boardId);
  const sessionPaused = !terminal && isSessionPaused(row);
  const pausedByOtherScope = row.paused && !sessionPaused;
  const boardHref =
    row.currentCardId === null
      ? routes.board(row.boardId)
      : `${routes.board(row.boardId)}?card=${encodeURIComponent(row.currentCardId)}`;
  const agentControlHref = routes.agentControl(row.boardId, "live");
  const bannerTone =
    row.stale || row.paused
      ? "border-[color-mix(in_oklab,var(--warning)_34%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_6%,transparent)]"
      : "border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-primary/6";
  const BannerIcon = row.paused ? Pause : row.stale ? Clock : Activity;

  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3.5 pt-3 pb-2 max-[760px]:px-3 max-[760px]:pt-2.5">
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
          <p className="m-0 mb-[3px] text-[11px] font-[650] tracking-[0.04em] text-muted-foreground uppercase">
            {t("agents.detail.sessionEyebrow", { board: row.boardTitle })}
          </p>
          <h2 className="m-0 text-[13px] font-[650] leading-[1.35] tracking-[-0.01em] break-words">
            {agentLabel(row)}
          </h2>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-4 max-[760px]:px-3 max-[760px]:pt-2.5">
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
              row.stale || row.paused
                ? "text-[color:var(--agent-tone-warning)]"
                : "text-[color:var(--agent-tone-primary)]",
            )}
            aria-hidden
          />
          <span className="min-w-0">{sessionHint(row, now, t)}</span>
        </div>

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <SessionStatePill session={row} />
          <HeartbeatText session={row} now={now} />
          <Link
            to={routes.board(row.boardId)}
            data-testid="agents-session-board-chip"
            className="inline-flex h-[21px] max-w-full items-center rounded-[4px] border border-border bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] px-1.5 text-[11px] leading-none font-semibold text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{row.boardTitle}</span>
          </Link>
          {row.paused &&
          row.pauseScope !== null &&
          row.pauseScope !== "session" ? (
            <AgentPauseBadge
              scope={row.pauseScope}
              title={row.pausedReason ?? undefined}
            />
          ) : null}
          {staleBoardIds.includes(row.boardId) ? (
            <span className="inline-flex h-[21px] items-center rounded-[4px] border border-[color-mix(in_oklab,var(--warning)_36%,var(--border))] bg-warning/7 px-1.5 text-[11px] font-semibold text-[color:var(--warning)]">
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
              <span
                className="block truncate font-mono text-[11px] text-muted-foreground"
                title={row.apiTokenId}
              >
                {shortId(row.apiTokenId, 12)}
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
                <span
                  className="block truncate"
                  title={row.cardTitle ?? row.currentCardId}
                >
                  {row.cardTitle ?? shortId(row.currentCardId)}
                </span>
              )}
            </MetaField>
            <MetaField label={t("agents.currentRun")}>
              {row.currentRunId === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span
                  data-testid="agents-session-current-run"
                  className="block truncate font-mono text-[11px]"
                  title={row.currentRunId}
                >
                  {t("agents.runHash", { id: runNumber(row.currentRunId) })}
                </span>
              )}
            </MetaField>
          </div>
        </section>

        <section
          data-testid="agents-session-current-work"
          className="border-b border-border-soft py-2.5"
        >
          <SectionHead
            icon={<GitCommit className="h-3 w-3" aria-hidden />}
            title={t("agents.detail.currentWork")}
          />
          <div className="flex flex-wrap gap-1.5">
            {row.currentCardId === null ? (
              <span className="text-[11px] text-muted-foreground">
                {sessionPaused
                  ? t("agents.detail.noCurrentCardPaused")
                  : terminal
                    ? t("agents.detail.noCurrentCardEnded")
                    : row.status === "idle" || row.status === "waiting_approval"
                      ? t("agents.detail.noCurrentCard")
                      : t("agents.detail.noCurrentCardActive")}
              </span>
            ) : (
              <Link
                to={boardHref}
                className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-border bg-[color-mix(in_oklab,var(--surface)_45%,transparent)] px-1.5 text-[11px] text-muted-foreground hover:border-[color:color-mix(in_oklab,var(--muted-foreground)_30%,var(--border))] hover:text-foreground"
              >
                <Folder className="h-[10px] w-[10px]" aria-hidden />
                {row.cardTitle ?? shortId(row.currentCardId)}
              </Link>
            )}
            {row.currentRunId !== null ? (
              <Link
                to={`${routes.agents}?${new URLSearchParams({
                  section: "runs",
                  board: row.boardId,
                  run: row.currentRunId,
                }).toString()}`}
                data-testid="agents-session-current-work-run"
                className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-border bg-[color-mix(in_oklab,var(--surface)_45%,transparent)] px-1.5 text-[11px] font-mono text-muted-foreground hover:border-[color:color-mix(in_oklab,var(--muted-foreground)_30%,var(--border))] hover:text-foreground"
              >
                <History className="h-[10px] w-[10px]" aria-hidden />
                {t("agents.runHash", { id: runNumber(row.currentRunId) })}
              </Link>
            ) : null}
          </div>
        </section>

        <section className="py-2.5">
          <SectionHead
            icon={<ShieldCheck className="h-3 w-3" aria-hidden />}
            title={t("agents.detail.pauseSemantics")}
          />
          <p className="m-0 text-[11px] leading-[1.45] text-muted-foreground">
            {t("agents.detail.claimsPrefix")}{" "}
            <span className="font-mono text-[11px]">403 agent_paused</span>
            {t("agents.detail.claimsSuffix")}
          </p>
        </section>
      </div>

      <div className="shrink-0 border-t border-border bg-surface/84 px-3.5 py-2.5 max-[760px]:px-3 max-[760px]:pt-[9px] max-[760px]:pb-[max(9px,env(safe-area-inset-bottom))]">
        <p
          data-testid={
            !terminal && !canControl ? "agents-session-read-only" : undefined
          }
          className="m-0 mb-2 flex items-start gap-[5px] text-[11px] leading-[1.45] text-muted-foreground"
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
              ? t("agents.detail.endedFooter")
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
              className={FOOTER_BUTTON_CLASS}
            >
              <Link
                to={agentControlHref}
                data-testid="agents-session-open-board"
              >
                {t("agents.openBoard")}
              </Link>
            </Button>
            {canControl && sessionPaused ? (
              <Button
                variant="outline"
                size="sm"
                className={`${FOOTER_BUTTON_CLASS} border-border-soft bg-hover text-foreground hover:bg-[color-mix(in_oklab,var(--hover)_70%,var(--border))]`}
                data-testid="agents-session-resume"
                onClick={() => setAction("resume")}
              >
                <Play className="h-[13px] w-[13px]" aria-hidden />
                {t("agents.action.resume")}
              </Button>
            ) : null}
            {canControl && !row.paused ? (
              <Button
                variant="outline"
                size="sm"
                className={`${FOOTER_BUTTON_CLASS} border-border-soft bg-hover text-foreground hover:bg-[color-mix(in_oklab,var(--hover)_70%,var(--border))]`}
                data-testid="agents-session-pause"
                onClick={() => setAction("pause")}
              >
                <Pause className="h-[13px] w-[13px]" aria-hidden />
                {t("agents.action.pause")}
              </Button>
            ) : null}
            {canControl ? (
              <Button
                variant="outline"
                size="sm"
                className={`${FOOTER_BUTTON_CLASS} border-[color-mix(in_oklab,var(--danger)_44%,var(--border))] bg-danger/5 text-[color:var(--danger)] hover:bg-danger/10 hover:text-[color:var(--danger)]`}
                data-testid="agents-session-end"
                onClick={() => setAction("end")}
              >
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
          row={{
            ...row,
            agentLabel: agentLabel(row),
            cardTitle: row.cardTitle,
          }}
          onClose={() => setAction(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
