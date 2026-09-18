import type {
  BoardAction,
  BoardSseEvent,
  CommandSseEvent,
  MembershipChange,
  PresenceUser,
} from "@janosik/shared";
import { ApiError, api, apiBaseUrl } from "@/api/client";

/**
 * Board realtime over SSE, loaded lazily (TASK-30).
 *
 * The roadmap's §7.0 note about `EventSource` and one-time tickets assumed
 * the browser API; a fetch-based reader is the same `text/event-stream` but
 * can send the `Authorization` header, so no token ever appears in a URL.
 * The module is a dynamic import on purpose: it only loads once a board is
 * on screen, keeping the reconnect logic off the critical path.
 *
 * `BoardRealtime` owns one connection at a time (the active board), resumes
 * from the last applied `seq` after every drop — the server replays the
 * missed delta before going live — and backs off on failures. Fatal answers
 * (401 after a failed refresh, 403/404) stop the loop instead of hammering.
 */

/** Parse a `text/event-stream` body into typed board events. */
export async function* parseEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<BoardSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const separator = buffer.indexOf("\n\n");
        if (separator === -1) break;
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = parseBlock(block);
        if (event !== null) yield event;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** One SSE block: `data:` lines joined, comments/keep-alives dropped. */
export function parseBlock(block: string): BoardSseEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (data === "" || data === "ping") return null;
  try {
    return JSON.parse(data) as BoardSseEvent;
  } catch {
    return null;
  }
}

export interface RealtimeOptions {
  /** Open one stream; the signal aborts it on stop/board switch. */
  open: (
    boardId: string,
    since: number,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  /** One committed event, in server order. */
  onEvent: (event: BoardSseEvent) => void;
  /** The last applied seq — the resume point of the next connection. */
  getSince: () => number;
  /** Backoff before attempt N (default 1s, 2s, 4s… capped at 30s). */
  retryDelayMs?: (attempt: number) => number;
  /** A stream opened: the caller starts its presence heartbeat. */
  onConnected?: (boardId: string) => void;
  /** The stream dropped (or stopped): the heartbeat pauses with it. */
  onDisconnected?: (boardId: string) => void;
  /** The stream was refused for good (401/403/404): the caller reacts. */
  onFatal?: (boardId: string, status: number) => void;
}

/** First retry delay; doubles per attempt up to `MAX_RETRY_MS`. */
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export class BoardRealtime {
  private boardId: string | null = null;
  private controller: AbortController | null = null;
  private attempt = 0;
  private stopped = true;
  private wake: (() => void) | null = null;

  constructor(private readonly options: RealtimeOptions) {}

  /** Follow a board (no-op when it is already the one being followed). */
  watch(boardId: string): void {
    if (this.boardId === boardId && !this.stopped) return;
    this.stop();
    this.boardId = boardId;
    this.stopped = false;
    void this.run(boardId);
  }

  /** Skip the backoff wait (the network came back). */
  wakeNow(): void {
    this.wake?.();
  }

  /** Drop the connection and refuse to reconnect until `watch`. */
  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
    this.wake?.();
    this.wake = null;
  }

  private async run(boardId: string): Promise<void> {
    while (!this.stopped && this.boardId === boardId) {
      const controller = new AbortController();
      this.controller = controller;
      let connected = false;
      try {
        const stream = await this.options.open(
          boardId,
          this.options.getSince(),
          controller.signal,
        );
        this.attempt = 0;
        connected = true;
        this.options.onConnected?.(boardId);
        for await (const event of parseEventStream(stream)) {
          if (this.stopped || this.boardId !== boardId) return;
          this.options.onEvent(event);
        }
        // Clean end (server restart, proxy timeout): reconnect at once.
      } catch (error) {
        if (this.stopped || this.boardId !== boardId) return;
        if (error instanceof ApiError && isFatal(error.status)) {
          this.boardId = null;
          this.options.onFatal?.(boardId, error.status);
          return;
        }
      } finally {
        if (connected) this.options.onDisconnected?.(boardId);
      }
      if (this.stopped || this.boardId !== boardId) return;
      this.attempt += 1;
      await this.pause(this.delay(this.attempt), controller);
    }
  }

  private delay(attempt: number): number {
    const custom = this.options.retryDelayMs;
    if (custom) return custom(attempt);
    return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (attempt - 1));
  }

  /** Wait `ms`, resolving early when stopped or woken by `wakeNow`. */
  private pause(ms: number, controller: AbortController): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped) {
        resolve();
        return;
      }
      const finish = (): void => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", finish);
        if (this.wake === finish) this.wake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      controller.signal.addEventListener("abort", finish, { once: true });
      this.wake = finish;
    });
  }
}

/** Statuses where retrying cannot help: the session or access is gone. */
function isFatal(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

/** Presence heartbeat cadence — comfortably inside the server's 60 s TTL. */
export const PRESENCE_PING_MS = 20_000;

/** A URL-safe tab id for presence (crypto when available, Math.random else). */
export function createClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** `POST /boards/:id/presence` — refresh the tab's presence TTL (TASK-36). */
export async function pingPresence(
  boardId: string,
  clientId: string,
): Promise<void> {
  const send = (): Promise<Response> => {
    const token = api.getAccessToken();
    return fetch(
      `${apiBaseUrl()}/boards/${encodeURIComponent(boardId)}/presence`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        credentials: "include",
        body: JSON.stringify({ clientId }),
      },
    ).catch(() => new Response(null, { status: 0 }));
  };
  const response = await send();
  if (response.status === 401) {
    await api.refreshSession().catch(() => null);
    await send();
  }
}

/**
 * `GET /boards/:id/events` as a stream, with the access token in a header
 * (never in the URL). One 401 retries through the shared refresh; a failed
 * refresh throws and the app falls back to the login screen.
 */
export async function openBoardEvents(
  boardId: string,
  since: number,
  signal: AbortSignal,
  clientId: string,
): Promise<ReadableStream<Uint8Array>> {
  let response = await requestEvents(boardId, since, clientId, signal);
  if (response.status === 401) {
    const restored = await api.refreshSession();
    // `null` with a token present: the refresh lost to a login/register that
    // started later (see `ApiClient.sessionEpoch`) — the token is fresh.
    if (restored === null && api.getAccessToken() === null) {
      throw new ApiError(401, null);
    }
    response = await requestEvents(boardId, since, clientId, signal);
  }
  if (!response.ok || response.body === null) {
    throw new ApiError(response.status, null);
  }
  return response.body;
}

function requestEvents(
  boardId: string,
  since: number,
  clientId: string,
  signal: AbortSignal,
): Promise<Response> {
  const token = api.getAccessToken();
  return fetch(
    `${apiBaseUrl()}/boards/${encodeURIComponent(boardId)}/events?since=${since}&client=${encodeURIComponent(clientId)}`,
    {
      headers: {
        Accept: "text/event-stream",
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      credentials: "include",
      signal,
    },
  ).catch(() => {
    throw new ApiError(0, null);
  });
}

/**
 * The bridge between the store and the stream: what a committed command
 * means for the local board. It lives in this lazily imported chunk so none
 * of the dedupe/queueing logic lands on the critical path — `BoardContext`
 * only hands it callbacks and calls `watch`/`settled`.
 */
export interface RealtimeHost {
  getActiveBoardId: () => string | undefined;
  /** Last applied seq of the board — the stream resume point. */
  getBaseline: (boardId: string) => number;
  /** Advance it; never moves backwards. */
  setBaseline: (boardId: string, seq: number) => void;
  apply: (action: BoardAction) => void;
  markForeign: (boardId: string, ids: readonly string[]) => void;
  /** The server's roster for the active board (TASK-36). */
  setPresence: (boardId: string, users: PresenceUser[]) => void;
  /** The board's member directory changed (TASK-36). */
  onMembershipChange: (
    boardId: string,
    userId: string,
    change: MembershipChange,
  ) => void;
  /** The caller lost access to the board (TASK-36). */
  onAccessRevoked: (boardId: string) => void;
  /** Someone else changed these entities: raise the attribution ring. */
  flagForeign: (
    boardId: string,
    actorId: string,
    ids: readonly string[],
  ) => void;
  isBusy: (boardId: string) => boolean;
  getUserId: () => string | undefined;
}

export interface RealtimeBridge {
  watch: (boardId: string) => void;
  stop: () => void;
  /** A command of ours settled: remember its seq and drain deferred events. */
  settled: (boardId: string, seq?: number) => void;
  dispose: () => void;
}

/** Entity-type prefixes of `Command.touches` labels (§7.3, TASK-30.1). */
const TOUCH_PREFIXES = new Set([
  "board",
  "column",
  "card",
  "label",
  "checklist",
  "checklistItem",
]);

/**
 * Plain entity ids out of server-computed `touches` labels: `card:<id>` →
 * `<id>`, and the same for every other prefix. Unknown prefixes are skipped
 * — the label space is server-owned and may grow. This replaces the local
 * `changedEntityIds` diff of the whole board that TASK-30 used per foreign
 * event: the server already knows exactly what it wrote.
 */
export function touchedEntityIds(touches: readonly string[]): string[] {
  const ids: string[] = [];
  for (const label of touches) {
    const separator = label.indexOf(":");
    if (separator === -1) continue;
    if (!TOUCH_PREFIXES.has(label.slice(0, separator))) continue;
    ids.push(label.slice(separator + 1));
  }
  return ids;
}

export function createRealtimeBridge(host: RealtimeHost): RealtimeBridge {
  /** Highest seq this client committed itself (per board). */
  const ownSeq = new Map<string, number>();
  /** Events that arrived while commands were in flight, in arrival order. */
  const deferred = new Map<string, CommandSseEvent[]>();

  const boardIdOf = (event: CommandSseEvent): string | undefined =>
    (event.action as { boardId?: string }).boardId;

  const applyForeign = (boardId: string, event: CommandSseEvent): void => {
    const { commandId: _spent, ...action } = event.action as BoardAction & {
      commandId?: string;
    };
    // The actor rides along (TASK-36): the reducer writes it into the card
    // activity feed, so the timeline names who did what, not just what.
    host.apply({ ...action, boardId, actorId: event.actorId } as BoardAction);
    const ids = touchedEntityIds(event.touches);
    if (ids.length > 0) {
      host.markForeign(boardId, ids);
      host.flagForeign(boardId, event.actorId, ids);
    }
  };

  const process = (event: CommandSseEvent): void => {
    const boardId = boardIdOf(event);
    if (boardId === undefined) return;
    const own =
      event.actorId === host.getUserId() &&
      event.seq <= (ownSeq.get(boardId) ?? 0);
    if (!own) applyForeign(boardId, event);
    host.setBaseline(boardId, event.seq);
  };

  const flush = (boardId: string): void => {
    if (host.isBusy(boardId)) return;
    const queue = deferred.get(boardId);
    if (queue === undefined || queue.length === 0) return;
    deferred.delete(boardId);
    for (const event of queue) process(event);
  };

  const handle = (event: BoardSseEvent): void => {
    // Presence is ephemeral state, not a command: no seq, no baseline, no
    // deferral — the roster simply replaces the previous one (TASK-36).
    if (event.type === "presence") {
      const boardId = host.getActiveBoardId();
      if (boardId !== undefined) host.setPresence(boardId, event.users);
      return;
    }
    // A membership change (TASK-36): the caller's own removal also ends the
    // stream (the server closes it right after the frame — stop first so the
    // clean end does not trigger an immediate reconnect); every change is
    // forwarded so open member lists can refresh.
    if (event.type === "membership") {
      if (event.change === "removed" && event.userId === host.getUserId()) {
        connection.stop();
      }
      host.onMembershipChange(event.boardId, event.userId, event.change);
      return;
    }
    // Activity events are TASK-37 — the wire type carries them.
    if (event.type !== "command") return;
    const boardId = boardIdOf(event);
    if (boardId === undefined) return;
    if (event.seq <= host.getBaseline(boardId)) return;
    if (host.isBusy(boardId)) {
      const queue = deferred.get(boardId) ?? [];
      queue.push(event);
      deferred.set(boardId, queue);
      return;
    }
    process(event);
  };

  // The tab's presence identity: stable across reconnects (a network blip
  // must not flicker the avatar) and unique per tab.
  const clientId = createClientId();

  // Presence heartbeat: the stream is one-way, so the tab refreshes its
  // session every 20 s (`PresenceService` sweeps at 60 s) and there is no
  // stale "online" dot to trust. Best effort — a failed ping only means the
  // next one, or the reconnect, will refresh the session.
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const ping = (): void => {
    const boardId = host.getActiveBoardId();
    if (boardId !== undefined) void pingPresence(boardId, clientId);
  };
  const startPing = (): void => {
    if (pingTimer !== null) return;
    ping();
    pingTimer = setInterval(ping, PRESENCE_PING_MS);
  };
  const stopPing = (): void => {
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
  };

  const connection = new BoardRealtime({
    open: (boardId, since, signal) =>
      openBoardEvents(boardId, since, signal, clientId),
    onEvent: handle,
    onConnected: startPing,
    onDisconnected: stopPing,
    onFatal: (boardId, status) => {
      // A 403 from the stream is the membership check: the account is no
      // longer on the board (a reconnect after removal, or a direct URL).
      // 401/404 are session/board-level and have their own paths.
      if (status === 403) host.onAccessRevoked(boardId);
    },
    getSince: () => {
      const active = host.getActiveBoardId();
      return active === undefined ? 0 : host.getBaseline(active);
    },
  });

  const onOnline = (): void => connection.wakeNow();
  const onVisible = (): void => {
    // A background tab throttles timers: coming back is a fresh heartbeat.
    if (document.visibilityState === "visible") ping();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  return {
    watch: (boardId) => connection.watch(boardId),
    stop: () => {
      stopPing();
      connection.stop();
    },
    settled: (boardId, seq) => {
      if (seq !== undefined && seq > 0) {
        ownSeq.set(boardId, Math.max(ownSeq.get(boardId) ?? 0, seq));
      }
      flush(boardId);
    },
    dispose: () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      stopPing();
      connection.stop();
      deferred.clear();
    },
  };
}
