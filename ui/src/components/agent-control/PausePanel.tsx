import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CirclePause,
  CirclePlay,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";
import type { AgentSessionDto, UserTokenDto } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { formatDate, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardActions, useBoardState } from "@/store/BoardContext";
import { AgentPauseBadge } from "@/components/agents/agents-ui";
import {
  AgentActionDialog,
  type AgentActionTarget,
  type AgentSessionAction,
} from "@/components/agents/AgentActionDialog";
import {
  HeartbeatText,
  SessionStatusPill,
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
          <SessionStatusPill status={session.status} />
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

      <div className="flex flex-wrap items-center justify-end gap-1 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:row-span-2">
        {admin && !terminal ? (
          <>
            {sessionPaused ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-resume"
                onClick={() => onAction("resume", session)}
                className="h-11 min-h-11 px-2 text-[11px] min-[761px]:h-[26px] min-[761px]:min-h-[26px]"
              >
                <CirclePlay className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.pause.resume")}
              </Button>
            ) : session.paused ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-pause"
                onClick={() => onAction("pause", session)}
                className="h-11 min-h-11 px-2 text-[11px] min-[761px]:h-[26px] min-[761px]:min-h-[26px]"
              >
                <CirclePause className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.pause.pause")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="agent-session-end"
              aria-label={t("agentControl.live.endSession")}
              title={t("agentControl.live.endSessionHint")}
              onClick={() => onAction("end", session)}
              className="h-11 w-11 min-h-11 border-danger/44 bg-danger/5 px-0 text-[color:var(--agent-tone-danger)] hover:bg-danger/10 hover:text-[color:var(--agent-tone-danger)] min-[761px]:h-6 min-[761px]:w-6 min-[761px]:min-h-6"
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid={pause ? "board-pause-dialog" : "board-resume-dialog"}
      >
        <DialogHeader>
          <span
            className={cn(
              "mb-1 grid h-8 w-8 place-items-center rounded-lg border",
              pause
                ? "border-warning/30 bg-warning/10 text-[color:var(--agent-tone-warning)]"
                : "border-success/30 bg-success/10 text-[color:var(--agent-tone-success)]",
            )}
          >
            {pause ? (
              <CirclePause className="h-4 w-4" aria-hidden />
            ) : (
              <CirclePlay className="h-4 w-4" aria-hidden />
            )}
          </span>
          <DialogTitle>
            {t(
              pause
                ? "agentControl.pause.boardPauseTitle"
                : "agentControl.pause.boardResumeTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              pause
                ? "agentControl.pause.boardPauseBody"
                : "agentControl.pause.boardResumeBody",
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">
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
            autoFocus
          />
        </label>
        {error !== null ? (
          <p
            role="alert"
            data-testid="board-pause-error"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-[color:var(--agent-tone-danger)]"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="min-h-11 sm:min-h-9"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant={pause ? "destructive" : "default"}
            disabled={busy}
            data-testid={pause ? "board-pause-confirm" : "board-resume-confirm"}
            onClick={() => onConfirm(reason.trim())}
            className="min-h-11 sm:min-h-9"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : pause ? (
              <CirclePause className="h-4 w-4" aria-hidden />
            ) : (
              <CirclePlay className="h-4 w-4" aria-hidden />
            )}
            {t(
              pause
                ? "agentControl.pause.pauseAgents"
                : "agentControl.pause.resumeAgents",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardPauseCard({
  paused,
  pausedAt,
  pauseReason,
  admin,
  onPause,
  onResume,
}: {
  paused: boolean;
  pausedAt: number | null;
  pauseReason: string | null;
  admin: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section
      data-testid="board-pause-status"
      data-paused={paused ? "true" : "false"}
      className={cn(
        "flex flex-wrap items-start gap-2.5 rounded-lg border px-2.5 py-2.5",
        paused
          ? "border-warning/34 bg-warning/5"
          : "border-success/30 bg-success/5",
      )}
    >
      <span
        className={cn(
          "grid h-[27px] w-[27px] shrink-0 place-items-center rounded-[7px] border",
          paused
            ? "border-warning/24 bg-warning/10 text-[color:var(--agent-tone-warning)]"
            : "border-success/24 bg-success/10 text-[color:var(--agent-tone-success)]",
        )}
      >
        {paused ? (
          <CirclePause className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[11.5px] font-[650] leading-[1.35]">
          {paused
            ? t("agentControl.live.boardPausedTitle")
            : t("agentControl.live.boardAllowedTitle")}
        </b>
        <p className="mt-0.5 text-[11px] leading-[1.5] text-muted-foreground">
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
      <div className="ml-auto flex flex-none flex-wrap items-center justify-end gap-1.5">
        {admin ? (
          paused ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="board-resume"
              onClick={onResume}
              className="min-h-11 min-[761px]:h-7 min-[761px]:min-h-7"
            >
              <CirclePlay className="h-3.5 w-3.5" aria-hidden />
              {t("agentControl.pause.resumeAgents")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="board-pause"
              onClick={onPause}
              className="min-h-11 border-danger/44 bg-danger/5 text-[color:var(--agent-tone-danger)] hover:bg-danger/10 hover:text-[color:var(--agent-tone-danger)] min-[761px]:h-7 min-[761px]:min-h-7"
            >
              <CirclePause className="h-3.5 w-3.5" aria-hidden />
              {t("agentControl.pause.pauseAgents")}
            </Button>
          )
        ) : (
          <span className="inline-flex h-[22px] items-center rounded-full border border-border px-2 text-[11px] font-[600] text-muted-foreground">
            {t("agentControl.live.readOnly")}
          </span>
        )}
      </div>
    </section>
  );
}

export function PausePanel({
  role,
  onChanged,
}: {
  role: "ADMIN" | "MEMBER" | "VIEWER" | undefined;
  onChanged?: () => void;
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
  const tokenNames = useMemo(
    () => new Map(tokens.map((token) => [token.id, token.name])),
    [tokens],
  );

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
          session.name ??
          session.clientName ??
          `Token ${shortId(session.apiTokenId)}`,
        rows: [session],
      });
    }
    return [...map.values()];
  }, [sessions, tokenNames]);

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
      <div className="flex min-h-[46px] flex-none flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <h3 className="m-0 mr-auto text-[12.5px] font-[650]">
          {t("agentControl.shell.live")}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {t("agentControl.live.summary", {
            count: sessions?.length ?? 0,
            tokens: groups.length,
            stale: staleCount,
          })}
        </span>
        <button
          type="button"
          data-testid="agent-live-refresh"
          aria-label={t("agentControl.live.refresh")}
          onClick={() => setRevision((value) => value + 1)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground min-[761px]:h-6 min-[761px]:w-6"
        >
          <RefreshCw className="h-[13px] w-[13px]" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
        <BoardPauseCard
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
        />

        {sessions !== null && !sessionsError ? (
          <>
            {sessions.length === 0 ? (
              <div className="mt-2 flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                <Bot className="h-6 w-6 opacity-60" aria-hidden />
                <p>{t("agentControl.live.empty")}</p>
              </div>
            ) : (
              <>
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
                              !isTerminalStatus(row.status) && !row.paused,
                          ).length,
                        })}
                        {group.rows.some((row) => row.paused)
                          ? ` · ${t("agentControl.live.groupPaused", {
                              count: group.rows.filter((row) => row.paused)
                                .length,
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
                    <ShieldCheck
                      className="mt-px h-3 w-3 shrink-0"
                      aria-hidden
                    />
                    {t("agentControl.live.readOnlyNote")}
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}

        <p
          data-testid="pause-semantics"
          className="mt-2.5 text-[11px] leading-[1.5] text-muted-foreground"
        >
          {t("agentControl.live.claims")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <p className="min-w-0 flex-1 text-[11px] leading-[1.45] text-muted-foreground">
            {t("agentControl.live.tokenHint")}
          </p>
          <button
            type="button"
            data-testid="agent-live-manage-tokens"
            onClick={openTokens}
            className="inline-flex min-h-11 items-center gap-1 text-[11px] font-[600] text-foreground hover:underline min-[761px]:min-h-7"
          >
            {t("agents.shell.manageTokens")} ↗
          </button>
        </div>
      </div>

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
