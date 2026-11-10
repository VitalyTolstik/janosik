import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CirclePause,
  CirclePlay,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { AgentSessionDto } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardActions, useBoardState } from "@/store/BoardContext";

/**
 * Pause / kill controls of one board (TASK-166.14).
 *
 * Board pause stops every PAT on the board; session pause stops writes
 * attributed to one `X-Agent-Session`. In-flight transactions finish, queued
 * writes after the pause are rejected with `403 agent_paused`, reads and
 * heartbeats stay available, and pause does not release claims. Token-level
 * pause and "stop all" live in Account → API keys because they are the token
 * owner's control, not a board admin's.
 *
 * The panel mounts only while the dialog is open. SSE `agent` frames refresh
 * the session list and flip the board pause flag; the durable aggregate is
 * refreshed by the provider's normal snapshot path on reload.
 */

const STATUS_KEYS: Record<AgentSessionDto["status"], MessageKey> = {
  active: "agentControl.sessions.status.active",
  idle: "agentControl.sessions.status.idle",
  waiting_approval: "agentControl.sessions.status.waitingApproval",
  completed: "agentControl.sessions.status.completed",
  failed: "agentControl.sessions.status.failed",
  cancelled: "agentControl.sessions.status.cancelled",
};

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

function SessionRow({
  session,
  admin,
  now,
  onPause,
  onResume,
  busy,
}: {
  session: AgentSessionDto;
  admin: boolean;
  now: number;
  onPause: (session: AgentSessionDto, reason: string) => Promise<boolean>;
  onResume: (session: AgentSessionDto) => Promise<boolean>;
  busy: boolean;
}) {
  const { t, lang } = useI18n();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    try {
      const ok = await onPause(session, reason.trim());
      if (ok) {
        setReasonOpen(false);
        setReason("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resume = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    try {
      await onResume(session);
    } finally {
      setSubmitting(false);
    }
  };

  const pausedByBoard = session.pauseScope === "board";
  const pausedByToken = session.pauseScope === "token";
  const sessionPaused = session.pauseScope === "session";

  return (
    <li
      data-testid={`agent-session-row-${session.id}`}
      data-status={session.status}
      data-paused={session.paused ? "true" : "false"}
      className="space-y-2 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <Bot className="h-3.5 w-3.5 text-primary" aria-hidden />
            {session.name ?? t("agentControl.sessions.unnamed")}
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                session.status === "active"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {t(STATUS_KEYS[session.status])}
            </span>
            {session.stale ? (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                {t("agentControl.sessions.stale")}
              </span>
            ) : null}
            {session.paused && session.pauseScope !== null ? (
              <span
                data-testid="agent-session-paused"
                className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
              >
                {t(SCOPE_KEYS[session.pauseScope])}
              </span>
            ) : null}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {[session.clientName, session.model]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || session.id}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {t("agentControl.sessions.meta", {
              token: session.apiTokenId,
              heartbeat: formatRelative(session.lastHeartbeatAt, lang, now),
            })}
          </p>
          {session.pausedReason ? (
            <p className="text-[10px] text-warning">
              {t("agentControl.pause.reasonLabel")}: {session.pausedReason}
            </p>
          ) : null}
          {pausedByBoard ? (
            <p className="text-[10px] text-muted-foreground">
              {t("agentControl.sessions.pausedByBoard")}
            </p>
          ) : null}
          {pausedByToken ? (
            <p className="text-[10px] text-muted-foreground">
              {t("agentControl.sessions.pausedByToken")}
            </p>
          ) : null}
        </div>

        {admin ? (
          <div className="flex items-center gap-1.5">
            {sessionPaused ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-resume"
                disabled={submitting || busy}
                onClick={() => void resume()}
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CirclePlay className="h-3.5 w-3.5" aria-hidden />
                )}
                {t("agentControl.pause.resume")}
              </Button>
            ) : session.paused ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agent-session-pause"
                disabled={submitting || busy || reasonOpen}
                onClick={() => setReasonOpen(true)}
              >
                <CirclePause className="h-3.5 w-3.5" aria-hidden />
                {t("agentControl.pause.pause")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {reasonOpen ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <label
            htmlFor={`session-pause-reason-${session.id}`}
            className="text-[11px] font-medium text-muted-foreground"
          >
            {t("agentControl.pause.reasonLabel")}
          </label>
          <Textarea
            id={`session-pause-reason-${session.id}`}
            data-testid="agent-session-pause-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("agentControl.pause.reasonPlaceholder")}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="agent-session-pause-confirm"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CirclePause className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("agentControl.pause.pause")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setReasonOpen(false);
                setReason("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PausePanel({
  role,
  onChanged,
}: {
  role: "ADMIN" | "MEMBER" | "VIEWER" | undefined;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const { refreshBoards } = useBoardActions();
  const live = useBoardLive();
  const [sessions, setSessions] = useState<AgentSessionDto[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const admin = role === "ADMIN";
  const boardId = board?.id;

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
    void api
      .listAgentSessions(boardId, true)
      .then(setSessions)
      .catch(() => {
        setSessionsError(true);
        setSessions([]);
      });
  }, [boardId]);

  useEffect(() => {
    setSessions(null);
    loadSessions();
  }, [loadSessions, revision]);

  const refreshAll = () => {
    loadSessions();
    void refreshBoards();
    onChanged?.();
  };

  const pauseBoard = async () => {
    if (boardId === undefined || busy) return;
    setBusy(true);
    try {
      const state = await api.pauseBoardAgents(
        boardId,
        reason.trim() === "" ? undefined : reason.trim(),
      );
      live.agentControl.setBoardPause(boardId, {
        paused: state.paused,
        at: state.pausedAt,
        reason: state.reason,
      });
      setReason("");
      toast.success(t("agentControl.pause.boardPausedToast"));
      refreshAll();
    } catch (error) {
      toast.error(sessionError(error, t));
    } finally {
      setBusy(false);
    }
  };

  const resumeBoard = async () => {
    if (boardId === undefined || busy) return;
    setBusy(true);
    try {
      const state = await api.resumeBoardAgents(boardId);
      live.agentControl.setBoardPause(boardId, {
        paused: state.paused,
        at: state.pausedAt,
        reason: state.reason,
      });
      setReason("");
      toast.success(t("agentControl.pause.boardResumedToast"));
      refreshAll();
    } catch (error) {
      toast.error(sessionError(error, t));
    } finally {
      setBusy(false);
    }
  };

  const pauseSession = async (
    session: AgentSessionDto,
    value: string,
  ): Promise<boolean> => {
    if (boardId === undefined) return false;
    setBusy(true);
    try {
      const updated = await api.pauseAgentSession(
        boardId,
        session.id,
        value === "" ? undefined : value,
      );
      setSessions((current) =>
        current === null
          ? current
          : current.map((row) => (row.id === updated.id ? updated : row)),
      );
      toast.success(t("agentControl.pause.sessionPausedToast"));
      return true;
    } catch (error) {
      toast.error(sessionError(error, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resumeSession = async (session: AgentSessionDto): Promise<boolean> => {
    if (boardId === undefined) return false;
    setBusy(true);
    try {
      const updated = await api.resumeAgentSession(boardId, session.id);
      setSessions((current) =>
        current === null
          ? current
          : current.map((row) => (row.id === updated.id ? updated : row)),
      );
      toast.success(t("agentControl.pause.sessionResumedToast"));
      return true;
    } catch (error) {
      toast.error(sessionError(error, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const activeCount = useMemo(() => sessions?.length ?? 0, [sessions]);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <section className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <CirclePause className="h-4 w-4 text-primary" aria-hidden />
              {t("agentControl.pause.boardTitle")}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {t("agentControl.pause.boardHint")}
            </p>
          </div>
          <span
            data-testid="board-pause-status"
            data-paused={paused ? "true" : "false"}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              paused
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-success/40 bg-success/10 text-success",
            )}
          >
            {paused
              ? t("agentControl.pause.paused")
              : t("agentControl.pause.running")}
          </span>
        </div>

        {paused ? (
          <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2 text-[11px]">
            <p className="text-warning">
              {pausedAt === null
                ? t("agentControl.pause.pausedNow")
                : t("agentControl.pause.pausedSince", {
                    date: formatDate(pausedAt, lang),
                  })}
            </p>
            {pauseReason ? (
              <p className="text-muted-foreground">
                {t("agentControl.pause.reasonLabel")}: {pauseReason}
              </p>
            ) : null}
          </div>
        ) : null}

        {admin ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <label
                htmlFor="board-pause-reason"
                className="text-[11px] font-medium text-muted-foreground"
              >
                {t("agentControl.pause.reasonLabel")}
              </label>
              <Textarea
                id="board-pause-reason"
                data-testid="board-pause-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t("agentControl.pause.reasonPlaceholder")}
              />
            </div>
            {paused ? (
              <Button
                type="button"
                size="sm"
                data-testid="board-resume"
                disabled={busy}
                onClick={() => void resumeBoard()}
                className="bg-success text-white hover:bg-success/90"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CirclePlay className="h-4 w-4" aria-hidden />
                )}
                {t("agentControl.pause.resumeAgents")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                data-testid="board-pause"
                disabled={busy}
                onClick={() => void pauseBoard()}
                className="bg-warning text-black hover:bg-warning/90"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CirclePause className="h-4 w-4" aria-hidden />
                )}
                {t("agentControl.pause.pauseAgents")}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-warning">
            {t("agentControl.pause.readOnly")}
          </p>
        )}

        <p
          className="rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground"
          data-testid="pause-semantics"
        >
          {t("agentControl.pause.semantics")}
        </p>
      </section>

      <section className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t("agentControl.sessions.title", { count: activeCount })}
          </h3>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="agent-sessions-refresh"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("agentControl.retry")}
          </Button>
        </div>

        {sessions === null && !sessionsError ? (
          <SessionSkeleton label={t("agentControl.sessions.loading")} />
        ) : null}
        {sessionsError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
            <p>{t("agentControl.sessions.loadError")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("agentControl.retry")}
            </Button>
          </div>
        ) : null}
        {sessions !== null && sessions.length === 0 && !sessionsError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            <Bot className="h-6 w-6 opacity-60" aria-hidden />
            <p>{t("agentControl.sessions.empty")}</p>
          </div>
        ) : null}
        {sessions !== null && sessions.length > 0 ? (
          <ul
            className="divide-y rounded-lg border"
            data-testid="agent-session-list"
          >
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                admin={admin}
                now={now}
                busy={busy}
                onPause={pauseSession}
                onResume={resumeSession}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <p className="mt-4 rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground">
        {t("agentControl.pause.tokenHint")}
      </p>
    </div>
  );
}
