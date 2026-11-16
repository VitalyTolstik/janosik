import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Pause,
  Play,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";
import type { AgentSessionDto, UserTokenDto } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { formatDate, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardActions, useBoardState } from "@/store/BoardContext";
import { AgentPauseBadge } from "@/components/agents/agents-ui";
import { AgentConfirmDialog } from "@/components/agents/AgentConfirmDialog";
import {
  AgentActionDialog,
  type AgentActionTarget,
  type AgentSessionAction,
} from "@/components/agents/AgentActionDialog";
import {
  HeartbeatText,
  SessionStatePill,
  TokenSettingsLink,
} from "@/components/agents/session-ui";
import {
  compactAge,
  isTerminalStatus,
  runNumber,
  shortId,
} from "@/components/agents/agent-model";

/**
 * Board Live (TASK-166.14 / TASK-179.4).
 *
 * Board pause stops every PAT on the board; session pause stops writes
 * attributed to one `X-Agent-Session`. In-flight transactions finish, queued
 * writes after the pause are rejected with `403 agent_paused`, reads and
 * heartbeats stay available, and pause does not release claims. Ending a
 * session is final and releases the cards it holds. Token-level pause,
 * stop-all and revoke are the token owner's controls in Account → API keys,
 * never board-admin actions, so this panel only links there.
 */

const SCOPE_KEYS: Record<
  NonNullable<AgentSessionDto["pauseScope"]>,
  MessageKey
> = {
  board: "agentControl.pause.scope.board",
  token: "agentControl.pause.scope.token",
  session: "agentControl.pause.scope.session",
};

function sessionError(error: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (error instanceof ApiError && error.offline) {
    return t("agentControl.error.offline");
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("agentControl.error.forbidden");
  }
  return t("agentControl.error.generic");
}

function SessionSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} testId="agent-session-skeleton">
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="space-y-1.5 rounded-lg border p-3">
            <Skeleton width={150} height={12} />
            <Skeleton width={220} height={10} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function LiveSessionRow({
  session,
  admin,
  now,
  cardTitles,
  onAction,
}: {
  session: AgentSessionDto;
  admin: boolean;
  now: number;
  cardTitles: Map<string, string>;
  onAction: (action: AgentSessionAction, session: AgentSessionDto) => void;
}) {
  const { t } = useI18n();
  const terminal = isTerminalStatus(session.status);
  const sessionPaused = session.pauseScope === "session";
  const pausedByOtherScope =
    session.paused && session.pauseScope !== null && !sessionPaused;

  return (
    <div
      data-testid={`agent-session-row-${session.id}`}
      data-status={session.status}
      data-paused={session.paused ? "true" : "false"}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-border-soft py-2 last:border-b-0 min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)_auto] min-[761px]:gap-2"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="max-w-full truncate text-[11px] font-[650] leading-[1.35]">
            {session.name ?? t("agentControl.sessions.unnamed")}
          </b>
          <SessionStatePill session={session} />
          {session.stale ? (
            <span
              data-testid="agent-session-no-heartbeat"
              className="inline-flex items-center rounded-[4px] border border-warning/34 bg-warning/6 px-1 py-px text-[11px] font-[650] text-[color:var(--agent-tone-warning)]"
            >
              {t("agentControl.live.noHeartbeatChip")}
            </span>
          ) : null}
          {session.paused && session.pauseScope !== null ? (
            <span data-testid="agent-session-paused">
              <AgentPauseBadge
                scope={session.pauseScope}
                title={session.pausedReason ?? undefined}
              />
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <HeartbeatText session={session} now={now} />
          <span aria-hidden>·</span>
          <span className="truncate">
            {[session.clientName, session.model]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || shortId(session.apiTokenId)}
          </span>
          <span aria-hidden>·</span>
          <span>
            {t("agents.startedAgo", {
              age: compactAge(Math.max(0, now - session.startedAt)),
            })}
          </span>
        </div>
        {session.pausedReason ? (
          <p className="mt-0.5 text-[11px] text-[color:var(--agent-tone-warning)]">
            {t("agentControl.pause.reasonValue")}: {session.pausedReason}
          </p>
        ) : null}
        {pausedByOtherScope ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("agentControl.live.pausedByScope", {
              scope: t(SCOPE_KEYS[session.pauseScope ?? "board"]),
            })}
          </p>
        ) : null}
      </div>

      <div className="min-w-0 max-[760px]:col-start-1 max-[760px]:row-start-2">
        <b className="block truncate text-[11px] font-[550] leading-[1.35]">
          {session.currentCardId === null
            ? t("agentControl.live.noCurrentCard")
            : (cardTitles.get(session.currentCardId) ??
              shortId(session.currentCardId))}
        </b>
        <span className="mt-px block truncate text-[11px] text-muted-foreground">
          {session.currentRunId === null
            ? t("agentControl.live.noCurrentRun")
            : t("agents.runHash", { id: runNumber(session.currentRunId) })}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:row-span-2 max-[760px]:w-[112px] max-[760px]:content-center">
        {admin && !terminal ? (
          <>
            {sessionPaused ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-resume"
                onClick={() => onAction("resume", session)}
                className="h-11 min-h-11 gap-[6px] rounded-[6px] px-[10px] text-[11px] font-[650] min-[761px]:px-[7px] min-[761px]:text-[10px] min-[761px]:h-[26px] min-[761px]:min-h-[26px] min-[761px]:bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] [&_svg]:!h-[13px] [&_svg]:!w-[13px]"
              >
                <Play className="h-[13px] w-[13px]" aria-hidden />
                {t("agentControl.pause.resume")}
              </Button>
            ) : session.paused ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-pause"
                onClick={() => onAction("pause", session)}
                className="h-11 min-h-11 gap-[6px] rounded-[6px] px-[10px] text-[11px] font-[650] min-[761px]:px-[7px] min-[761px]:text-[10px] min-[761px]:h-[26px] min-[761px]:min-h-[26px] min-[761px]:bg-[color-mix(in_oklab,var(--surface)_65%,transparent)] [&_svg]:!h-[13px] [&_svg]:!w-[13px]"
              >
                <Pause className="h-[13px] w-[13px]" aria-hidden />
                {t("agentControl.pause.pause")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="agent-session-end"
              aria-label={t("agentControl.live.endSession")}
              title={t("agentControl.live.endSessionHint")}
              onClick={() => onAction("end", session)}
              className="h-11 w-11 min-h-11 rounded-[5px] px-0 text-[13px] font-normal leading-none text-muted-foreground hover:bg-hover hover:text-foreground min-[761px]:h-6 min-[761px]:w-6 min-[761px]:min-h-6 [&_svg]:!h-3.5 [&_svg]:!w-3.5"
            >
              <Square className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BoardPauseDialog({
  kind,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  kind: "pause" | "resume";
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const pause = kind === "pause";
  return (
    <AgentConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      icon={pause ? Pause : Play}
      tone={pause ? "danger" : "primary"}
      title={t(
        pause
          ? "agentControl.pause.boardPauseTitle"
          : "agentControl.pause.boardResumeTitle",
      )}
      description={t(
        pause
          ? "agentControl.pause.boardPauseBody"
          : "agentControl.pause.boardResumeBody",
      )}
      confirmLabel={t(
        pause
          ? "agentControl.pause.pauseAgents"
          : "agentControl.pause.resumeAgents",
      )}
      onConfirm={() => onConfirm(reason.trim())}
      busy={busy}
      error={error}
      errorTestId="board-pause-error"
      testId={pause ? "board-pause-dialog" : "board-resume-dialog"}
      confirmTestId={pause ? "board-pause-confirm" : "board-resume-confirm"}
      cancelTestId="board-pause-cancel"
      confirmClassName="min-w-[122px]"
    >
      <label className="mt-[10px] block space-y-[3px]">
        <span className="text-[10.5px] font-semibold text-muted-foreground">
          {t("agentControl.pause.reasonLabel")}
        </span>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t(
            pause
              ? "agentControl.pause.boardReasonPlaceholder"
              : "agentControl.pause.boardResumeReasonPlaceholder",
          )}
          data-testid={pause ? "board-pause-reason" : "board-resume-reason"}
          className="min-h-[70px] resize-y rounded-[6px] border-border bg-background px-2 py-2 text-[11.5px] leading-[1.55] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
          autoFocus
        />
      </label>
    </AgentConfirmDialog>
  );
}

function LiveStatusCard({
  paused,
  pausedAt,
  pauseReason,
  admin,
  onPause,
  onResume,
  onManageTokens,
}: {
  paused: boolean;
  pausedAt: number | null;
  pauseReason: string | null;
  admin: boolean;
  onPause: () => void;
  onResume: () => void;
  onManageTokens: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section
      className={cn("live-status-card", paused && "is-paused")}
      data-testid="live-status-card"
      data-paused={paused ? "true" : "false"}
    >
      <span className="live-icon">
        {paused ? (
          <Pause className="icon" aria-hidden="true" />
        ) : (
          <Activity className="icon" aria-hidden="true" />
        )}
      </span>
      <div className="live-status-main">
        <b>
          {paused
            ? t("agentControl.live.boardPausedTitle")
            : t("agentControl.live.boardAllowedTitle")}
        </b>
        <p>
          {paused
            ? t("agentControl.live.boardPausedBody", {
                when:
                  pausedAt === null
                    ? t("agentControl.live.pausedNow")
                    : t("agentControl.live.pausedWhen", {
                        date: formatDate(pausedAt, lang),
                      }),
                reason: pauseReason === null ? "" : ` · ${pauseReason}`,
              })
            : t("agentControl.live.boardAllowedBody")}
        </p>
      </div>
      <div className="live-status-actions">
        {admin ? (
          paused ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="live-status-resume"
              onClick={onResume}
            >
              <Play className="icon" aria-hidden="true" />
              {t("agentControl.pause.resumeAgents")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              data-testid="live-status-pause"
              onClick={onPause}
            >
              <Pause className="icon" aria-hidden="true" />
              {t("agentControl.pause.pauseAgents")}
            </button>
          )
        ) : (
          <span className="chip">{t("agentControl.live.readOnly")}</span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid="agent-live-manage-tokens"
          onClick={onManageTokens}
        >
          <KeyRound className="icon" aria-hidden="true" />
          {t("agents.shell.manageTokens")}
          <ArrowUpRight className="icon" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function PausePanel({
  role,
  onChanged,
  onClose,
}: {
  role: "ADMIN" | "MEMBER" | "VIEWER" | undefined;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const { refreshBoards } = useBoardActions();
  const live = useBoardLive();
  const [sessions, setSessions] = useState<AgentSessionDto[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [tokens, setTokens] = useState<UserTokenDto[]>([]);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [boardDialog, setBoardDialog] = useState<"pause" | "resume" | null>(
    null,
  );
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [action, setAction] = useState<{
    action: AgentSessionAction;
    session: AgentSessionDto;
  } | null>(null);
  const admin = role === "ADMIN";
  const boardId = board?.id;
  const boardTitle = board?.title ?? boardId ?? "";
  const cardTitles = useMemo(
    () =>
      new Map(
        Object.values(board?.cards ?? {}).map((card) => [card.id, card.title]),
      ),
    [board?.cards],
  );

  // Live board pause revisions (SSE) and the session-list refresh signal.
  useEffect(
    () => live.agentControl.subscribeAgent(() => setRevision((v) => v + 1)),
    [live],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const livePause = live.agentControl.getBoardPause(boardId);
  // Subscribe so SSE pause/resume frames repaint the board card without
  // polling; the event itself also bumps `revision` for the session list.
  const [, setLiveTick] = useState(0);
  useEffect(
    () => live.agentControl.subscribe(() => setLiveTick((v) => v + 1)),
    [live],
  );

  const paused =
    livePause?.paused ??
    (board?.agentsPausedAt !== undefined && board.agentsPausedAt !== null);
  const pausedAt =
    livePause?.paused === false
      ? null
      : (livePause?.at ?? board?.agentsPausedAt ?? null);
  const pauseReason =
    livePause?.paused === false
      ? null
      : (livePause?.reason ?? board?.agentsPauseReason ?? null);

  const loadSessions = useCallback(() => {
    if (boardId === undefined || !isApiEnabled()) return;
    setSessionsError(false);
    // The token map only decides whether a settings link is owner-safe; it
    // must never block the live session list.
    void api
      .listTokens()
      .then(setTokens)
      .catch(() => setTokens([]));
    void api
      .listAgentSessions(boardId, true)
      .then(setSessions)
      .catch(() => {
        setSessionsError(true);
        setSessions([]);
      });
  }, [boardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first rows land in the async fetch, not synchronously
    loadSessions();
  }, [loadSessions, revision]);

  const refreshAll = () => {
    loadSessions();
    void refreshBoards();
    onChanged?.();
  };

  const confirmBoardPause = async (reason: string) => {
    if (boardId === undefined || boardBusy) return;
    setBoardBusy(true);
    setBoardError(null);
    try {
      const state = await api.pauseBoardAgents(
        boardId,
        reason === "" ? undefined : reason,
      );
      live.agentControl.setBoardPause(boardId, {
        paused: state.paused,
        at: state.pausedAt,
        reason: state.reason,
      });
      toast.success(t("agentControl.pause.boardPausedToast"));
      setBoardDialog(null);
      refreshAll();
    } catch (error) {
      setBoardError(sessionError(error, t));
      toast.error(sessionError(error, t));
    } finally {
      setBoardBusy(false);
    }
  };

  const confirmBoardResume = async (reason: string) => {
    if (boardId === undefined || boardBusy) return;
    setBoardBusy(true);
    setBoardError(null);
    try {
      const state = await api.resumeBoardAgents(
        boardId,
        reason === "" ? undefined : reason,
      );
      live.agentControl.setBoardPause(boardId, {
        paused: state.paused,
        at: state.pausedAt,
        reason: state.reason,
      });
      toast.success(t("agentControl.pause.boardResumedToast"));
      setBoardDialog(null);
      refreshAll();
    } catch (error) {
      setBoardError(sessionError(error, t));
      toast.error(sessionError(error, t));
    } finally {
      setBoardBusy(false);
    }
  };

  const ownTokenIds = useMemo(
    () => new Set(tokens.map((token) => token.id)),
    [tokens],
  );
  const tokenNames = useMemo(() => {
    const names = new Map(tokens.map((token) => [token.id, token.name]));
    for (const session of sessions ?? []) {
      if (names.has(session.apiTokenId) || session.tokenName == null) continue;
      names.set(session.apiTokenId, session.tokenName);
    }
    return names;
  }, [sessions, tokens]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { tokenId: string; name: string; rows: AgentSessionDto[] }
    >();
    for (const session of sessions ?? []) {
      const existing = map.get(session.apiTokenId);
      if (existing !== undefined) {
        existing.rows.push(session);
        continue;
      }
      map.set(session.apiTokenId, {
        tokenId: session.apiTokenId,
        name:
          tokenNames.get(session.apiTokenId) ??
          session.clientName ??
          session.name ??
          `Token ${shortId(session.apiTokenId)}`,
        rows: [session],
      });
    }
    return [...map.values()].sort((a, b) => {
      const ownA = ownTokenIds.has(a.tokenId) ? 0 : 1;
      const ownB = ownTokenIds.has(b.tokenId) ? 0 : 1;
      return ownA - ownB || a.name.localeCompare(b.name);
    });
  }, [ownTokenIds, sessions, tokenNames]);

  const staleCount = (sessions ?? []).filter((session) => session.stale).length;
  const actionTarget: AgentActionTarget | null =
    action === null
      ? null
      : {
          id: action.session.id,
          boardId: action.session.boardId,
          apiTokenId: action.session.apiTokenId,
          name: action.session.name,
          boardTitle,
          tokenName: tokenNames.get(action.session.apiTokenId) ?? null,
          agentLabel:
            tokenNames.get(action.session.apiTokenId) ??
            action.session.clientName ??
            action.session.name ??
            null,
          cardTitle:
            action.session.currentCardId === null
              ? null
              : (cardTitles.get(action.session.currentCardId) ?? null),
        };

  const openTokens = () =>
    window.dispatchEvent(new Event("janosik:open-api-keys"));

  const onSaved = (updated: AgentSessionDto) => {
    setSessions((current) => {
      if (current === null) return current;
      if (isTerminalStatus(updated.status)) {
        return current.filter((row) => row.id !== updated.id);
      }
      return current.map((row) => (row.id === updated.id ? updated : row));
    });
    onChanged?.();
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-live-panel"
    >
      <div className="ac-toolbar">
        <h3>{t("agentControl.shell.live")}</h3>
        <span className="meta">
          {sessions !== null && sessions.length > 0
            ? t("agentControl.live.summary", {
                count: sessions.length,
                tokens: groups.length,
                stale: staleCount,
              })
            : t("agentControl.live.summaryZero")}
        </span>
        {sessions !== null && sessions.length > 0 ? (
          <button
            type="button"
            data-testid="agent-live-refresh"
            aria-label={t("agentControl.live.refresh")}
            onClick={() => setRevision((value) => value + 1)}
            className="icon-btn-sm"
            style={{ marginLeft: "auto" }}
          >
            <RefreshCw className="icon" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="ac-panel-scroll">
        {sessions === null && !sessionsError ? (
          <SessionSkeleton label={t("agentControl.sessions.loading")} />
        ) : null}
        {sessionsError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            <AlertTriangle
              className="h-5 w-5 text-[color:var(--agent-tone-warning)]"
              aria-hidden
            />
            <p>{t("agentControl.sessions.loadError")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
              className="max-md:min-h-11"
            >
              {t("agentControl.retry")}
            </Button>
          </div>
        ) : null}

        {sessions !== null && !sessionsError && sessions.length === 0 ? (
          <div className="empty-state" data-testid="agent-live-empty">
            <span className="empty-icon">
              <Activity className="icon" aria-hidden="true" />
            </span>
            <h3>{t("agentControl.live.emptyTitle")}</h3>
            <p>{t("agentControl.live.emptyBody")}</p>
          </div>
        ) : null}

        {sessions !== null && !sessionsError && sessions.length > 0 ? (
          <>
            <LiveStatusCard
              paused={paused}
              pausedAt={pausedAt}
              pauseReason={pauseReason}
              admin={admin}
              onPause={() => {
                setBoardError(null);
                setBoardDialog("pause");
              }}
              onResume={() => {
                setBoardError(null);
                setBoardDialog("resume");
              }}
              onManageTokens={openTokens}
            />

            {groups.map((group) => (
              <section key={group.tokenId} className="mt-2.5">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border-soft py-1.5">
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] border border-border bg-surface text-muted-foreground">
                    <Bot className="h-3 w-3" aria-hidden />
                  </span>
                  <b className="min-w-0 truncate text-[11px] font-[650]">
                    {group.name}
                  </b>
                  <span className="max-w-full truncate rounded-[3px] border border-border bg-background px-1 py-px font-mono text-[11px] text-muted-foreground">
                    {shortId(group.tokenId, 12)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("agentControl.live.groupLive", {
                      count: group.rows.filter(
                        (row) =>
                          (row.status === "active" ||
                            row.status === "waiting_approval") &&
                          !row.paused &&
                          !row.stale,
                      ).length,
                    })}
                    {group.rows.some((row) => row.stale && !row.paused)
                      ? ` · ${t("agents.groups.noHeartbeat", { count: group.rows.filter((row) => row.stale && !row.paused).length })}`
                      : ""}
                    {group.rows.some((row) => row.paused)
                      ? ` · ${t("agentControl.live.groupPaused", {
                          count: group.rows.filter((row) => row.paused).length,
                        })}`
                      : ""}
                  </span>
                  <span className="ml-auto">
                    <TokenSettingsLink
                      isOwn={ownTokenIds.has(group.tokenId)}
                      onOpen={openTokens}
                      testId={`agent-live-token-settings-${group.tokenId}`}
                    />
                  </span>
                </div>
                {group.rows.map((session) => (
                  <LiveSessionRow
                    key={session.id}
                    session={session}
                    admin={admin}
                    now={now}
                    cardTitles={cardTitles}
                    onAction={(nextAction, row) =>
                      setAction({ action: nextAction, session: row })
                    }
                  />
                ))}
              </section>
            ))}

            {!admin ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-px h-3 w-3 shrink-0" aria-hidden />
                {t("agentControl.live.readOnlyNote")}
              </div>
            ) : null}

            <p
              data-testid="pause-semantics"
              className="mt-[9px] mb-0 text-[11px] leading-[1.5] text-muted-foreground"
            >
              {t("agentControl.live.claims")}
            </p>
          </>
        ) : null}
      </div>

      <footer
        className="ac-foot"
        data-testid="board-pause-status"
        data-paused={paused ? "true" : "false"}
      >
        <span className="ac-foot-note">
          <ShieldCheck className="icon" aria-hidden="true" />
          {t(
            admin
              ? "agentControl.live.pauseFooter"
              : "agentControl.live.memberFooter",
          )}
          {sessions !== null &&
          sessions.length === 0 &&
          paused &&
          pauseReason !== null
            ? ` · ${pauseReason}`
            : ""}
        </span>
        <div className="ac-foot-actions">
          {admin ? (
            paused ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="board-resume"
                onClick={() => {
                  setBoardError(null);
                  setBoardDialog("resume");
                }}
              >
                <Play className="icon" aria-hidden="true" />
                {t("agentControl.pause.resumeAgents")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                data-testid="board-pause"
                onClick={() => {
                  setBoardError(null);
                  setBoardDialog("pause");
                }}
              >
                <Pause className="icon" aria-hidden="true" />
                {t("agentControl.pause.pauseAgents")}
              </button>
            )
          ) : onClose !== undefined ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="agent-live-close"
              onClick={onClose}
            >
              {t("common.close")}
            </button>
          ) : null}
        </div>
      </footer>

      {boardDialog !== null ? (
        <BoardPauseDialog
          kind={boardDialog}
          busy={boardBusy}
          error={boardError}
          onConfirm={(reason) => {
            if (boardDialog === "pause") void confirmBoardPause(reason);
            else void confirmBoardResume(reason);
          }}
          onClose={() => {
            if (!boardBusy) {
              setBoardDialog(null);
              setBoardError(null);
            }
          }}
        />
      ) : null}

      {action !== null && actionTarget !== null ? (
        <AgentActionDialog
          action={action.action}
          row={actionTarget}
          onClose={() => setAction(null)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
