import type {
  ActivitySseEvent,
  BoardAction,
  BoardSseEvent,
  CommandSseEvent,
  MembershipChange,
  PresenceSseEvent,
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
 * (401 after a failed refresh, 403/404/410) stop the loop instead of
 * hammering.
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
      // A frame is a small JSON object; a peer that streams megabytes without
      // a separator must not grow the client's memory (or the regex cost)
      // without bound. Throwing forces a reconnect instead (TASK-147
      // follow-up).
      if (buffer.length > MAX_EVENT_BUFFER_BYTES) {
        throw new Error("SSE frame exceeded the buffer limit");
      }
      for (;;) {
        // Accept both `\n\n` and a proxy's `\r\n\r\n` (A10): SSE frames may
        // legally end either way.
        const match = /\r?\n\r?\n/.exec(buffer);
        if (match === null) break;
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseBlock(block);
        if (event !== null) yield event;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** Cap on the un-parsed SSE buffer — one frame is a few KB at most. */
const MAX_EVENT_BUFFER_BYTES = 1_000_000;

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
  /** The stream was refused for good (401/403/404/410): the caller reacts. */
  onFatal?: (boardId: string, status: number) => void;
  /**
   * The server refused this tab's presence id (`409 client_id_taken`, e.g. a
   * duplicated link): the caller must mint a new one. The stream is retried
   * at once, not treated as a fatal access error (TASK-147 follow-up).
   */
  onClientIdTaken?: () => void;
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
  /** `reconnect()` asks the loop to skip its backoff once. */
  private skipBackoff = false;
  /** Consecutive `client_id_taken` answers for the current board. */
  private clientIdRetries = 0;

  constructor(private readonly options: RealtimeOptions) {}

  /** Follow a board (no-op when it is already the one being followed). */
  watch(boardId: string): void {
    if (this.boardId === boardId && !this.stopped) return;
    this.stop();
    this.boardId = boardId;
    this.stopped = false;
    this.skipBackoff = false;
    this.clientIdRetries = 0;
    void this.run(boardId);
  }

  /**
   * Reopen the stream at once (TASK-145): a presence epoch gap or a swept
   * session means the current stream's view is incomplete, and only a fresh
   * connection (which re-joins and re-`sync`s) repairs it. Resets the
   * backoff so the reconnect is immediate, not after a long pause.
   *
   * `skipBackoff` is what makes it immediate even when the stream is *live*
   * (an abort throws out of `for await`, and the loop would otherwise sleep
   * for the first backoff step before reopening).
   */
  reconnect(): void {
    this.attempt = 0;
    this.skipBackoff = true;
    this.controller?.abort();
    this.wakeNow();
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
        this.skipBackoff = false;
        this.clientIdRetries = 0;
        connected = true;
        this.options.onConnected?.(boardId);
        for await (const event of parseEventStream(stream)) {
          if (this.stopped || this.boardId !== boardId) return;
          this.options.onEvent(event);
        }
        // Clean end (server restart, proxy timeout): reconnect at once.
      } catch (error) {
        if (this.stopped || this.boardId !== boardId) return;
        // A taken tab id is recoverable: mint a fresh one and rejoin, rather
        // than surfacing it as a fatal access error (TASK-147 follow-up).
        if (error instanceof ApiError && error.code === "client_id_taken") {
          this.options.onClientIdTaken?.();
          this.clientIdRetries += 1;
          if (this.clientIdRetries <= 3) {
            await this.pause(200, controller);
            continue;
          }
        }
        if (error instanceof ApiError && isFatal(error.status)) {
          this.boardId = null;
          this.options.onFatal?.(boardId, error.status);
          return;
        }
      } finally {
        if (connected) this.options.onDisconnected?.(boardId);
      }
      if (this.stopped || this.boardId !== boardId) return;
      if (this.skipBackoff) {
        this.skipBackoff = false;
        await this.pause(0, controller);
      } else {
        this.attempt += 1;
        await this.pause(this.delay(this.attempt), controller);
      }
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

/**
 * Statuses where retrying cannot help: the session or access is gone, or
 * (`410`, the public share stream) the board behind a live link was deleted.
 */
function isFatal(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

/** Presence heartbeat cadence — comfortably inside the server's 60 s TTL. */
export const PRESENCE_PING_MS = 20_000;

/** A URL-safe tab id for presence (crypto when available, Math.random else). */
export function createClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** `POST /boards/:id/presence` — refresh the tab's presence TTL (TASK-36).
 *  Resolves with the response status so the caller can react to a `410`
 *  (the session was swept) by rejoining (TASK-145). */
export async function pingPresence(
  boardId: string,
  clientId: string,
): Promise<number> {
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
  let response = await send();
  if (response.status === 401) {
    await api.refreshSession().catch(() => null);
    response = await send();
  }
  return response.status;
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
  if (response.status === 409) {
    // The presence tab id is taken (a duplicated link/tab copy). Keep the
    // body so `BoardRealtime` can read `code: "client_id_taken"` and mint a
    // fresh id instead of treating it as a fatal access error.
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(409, body);
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
 * The outcome of a snapshot refetch the bridge asked for: `applied` — the
 * board now shows the snapshot and the baseline moved to its seq; `busy` —
 * local commands ran while it was in flight, so it was discarded (ask again
 * once they settle); `stale` — the snapshot was older than the baseline;
 * `skipped`/`failed` — not the active board any more, or the network.
 */
export type RefetchResult = "applied" | "busy" | "stale" | "skipped" | "failed";

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
  /** Apply a presence delta/sync to the active board's roster (TASK-36). */
  applyPresence: (boardId: string, event: PresenceSseEvent) => void;
  /** The board's member directory changed (TASK-36). */
  onMembershipChange: (
    boardId: string,
    userId: string,
    change: MembershipChange,
  ) => void;
  /** The caller lost access to the board (TASK-36). */
  onAccessRevoked: (boardId: string) => void;
  /** A non-command activity frame — a comment (TASK-37). */
  onActivity: (event: ActivitySseEvent) => void;
  /** Someone else changed these entities: raise the attribution ring. */
  flagForeign: (
    boardId: string,
    actorId: string,
    ids: readonly string[],
  ) => void;
  isBusy: (boardId: string) => boolean;
  getUserId: () => string | undefined;
  /**
   * Did this client send the command with this idempotency key? (U-1 —
   * own echoes are recognised by key, never by actor alone.)
   */
  isOwnCommand: (boardId: string, commandId: string) => boolean;
  /** Pull a fresh snapshot of the board (single-flight on the host side). */
  refetch: (boardId: string) => Promise<RefetchResult>;
  /**
   * When the board was last known to be in sync with the server (a snapshot
   * or a live stream) — `undefined` when never. Drives the idle snapshot.
   */
  getSyncedAt: (boardId: string) => number | undefined;
  /** The stream for the board was live up to now. */
  markSynced: (boardId: string) => void;
  /**
   * A board idle for longer than this is re-read as one snapshot instead of
   * replaying its whole backlog event by event (U-9). Default 5 minutes.
   */
  idleSnapshotMs?: number;
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

/** Default idle window before a board is re-read as a snapshot (U-9). */
export const IDLE_SNAPSHOT_MS = 5 * 60_000;

export function createRealtimeBridge(host: RealtimeHost): RealtimeBridge {
  /** Highest seq this client committed itself (per board). */
  const ownSeq = new Map<string, number>();
  /** Last presence epoch applied to the active board (TASK-145). */
  let presenceEpoch: number | undefined;
  /** Events that arrived while commands were in flight, in arrival order. */
  const deferred = new Map<string, CommandSseEvent[]>();
  /**
   * Boards whose local state must be re-read as a snapshot before more
   * events can be applied: the server asked for it (`resync`), or a foreign
   * event turned out to precede one of our own already-applied commands.
   * Events are held back until the snapshot lands.
   */
  const resyncWanted = new Set<string>();
  const resyncRunning = new Set<string>();

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

  /**
   * Is this the echo of a command this client sent? By idempotency key when
   * the server reports it (U-1): the same account may have other writers —
   * another tab, an MCP agent on the user's personal key — whose commands
   * must be applied even though the actor matches. An older server without
   * `commandId` falls back to the key inside the action, and only then to
   * the actor-and-seq heuristic.
   */
  const isOwn = (boardId: string, event: CommandSseEvent): boolean => {
    const key =
      event.commandId ?? (event.action as { commandId?: string }).commandId;
    if (key !== undefined && key !== "") return host.isOwnCommand(boardId, key);
    return (
      event.actorId === host.getUserId() &&
      event.seq <= (ownSeq.get(boardId) ?? 0)
    );
  };

  /**
   * Apply one event. Returns `false` when it cannot be applied in order: a
   * foreign event the server committed *before* one of our own commands
   * that the local state already shows (U-7) — applying it on top would
   * reorder the two, so the board is re-read instead.
   */
  const process = (
    event: CommandSseEvent,
    allowOutOfOrder: boolean,
  ): boolean => {
    const boardId = boardIdOf(event);
    if (boardId === undefined) return true;
    if (isOwn(boardId, event)) {
      host.setBaseline(boardId, event.seq);
      return true;
    }
    if (!allowOutOfOrder && event.seq < (ownSeq.get(boardId) ?? 0)) {
      return false;
    }
    applyForeign(boardId, event);
    host.setBaseline(boardId, event.seq);
    return true;
  };

  const defer = (boardId: string, event: CommandSseEvent): void => {
    const queue = deferred.get(boardId) ?? [];
    queue.push(event);
    deferred.set(boardId, queue);
  };

  const flush = (boardId: string, allowOutOfOrder = false): void => {
    if (host.isBusy(boardId)) return;
    if (resyncWanted.has(boardId)) {
      tryResync(boardId);
      return;
    }
    const queue = deferred.get(boardId);
    if (queue === undefined || queue.length === 0) return;
    deferred.delete(boardId);
    for (let index = 0; index < queue.length; index += 1) {
      const event = queue[index];
      // A snapshot may have covered it in the meantime.
      if (event.seq <= host.getBaseline(boardId)) continue;
      if (!process(event, allowOutOfOrder)) {
        // Keep the rest (this event included) for after the snapshot.
        deferred.set(boardId, [
          ...queue.slice(index),
          ...(deferred.get(boardId) ?? []),
        ]);
        requestResync(boardId);
        return;
      }
    }
  };

  const tryResync = (boardId: string): void => {
    if (!resyncWanted.has(boardId) || resyncRunning.has(boardId)) return;
    // Our own commands are in flight: their optimistic state must not be
    // replaced — `settled` retries once they are answered.
    if (host.isBusy(boardId)) return;
    resyncRunning.add(boardId);
    void host
      .refetch(boardId)
      .catch((): RefetchResult => "failed")
      .then((result) => {
        resyncRunning.delete(boardId);
        if (result === "busy") {
          // Commands started meanwhile; `settled` asks again.
          if (!host.isBusy(boardId)) tryResync(boardId);
          return;
        }
        resyncWanted.delete(boardId);
        // Applied: everything up to the snapshot's seq is dropped by the
        // baseline check. Otherwise (offline, board switched away) the held
        // events are applied as they are — the best this tab can do now;
        // the next focus refetch reconciles.
        flush(boardId, result !== "applied");
      });
  };

  const requestResync = (boardId: string): void => {
    resyncWanted.add(boardId);
    tryResync(boardId);
  };

  const handle = (event: BoardSseEvent): void => {
    // Presence is ephemeral state, not a command: no seq, no baseline, no
    // deferral. `sync` replaces the roster; `join`/`leave`/`update` mutate it
    // in place (TASK-36). Every frame carries the board's presence epoch.
    if (event.type === "presence") {
      if (event.epoch !== undefined) presenceEpoch = event.epoch;
      const boardId = host.getActiveBoardId();
      if (boardId !== undefined) host.applyPresence(boardId, event);
      return;
    }
    // Keep-alive (TASK-145): an epoch ahead of ours means a presence delta
    // was missed; reopening the stream yields a fresh `sync` rather than
    // leaving an incomplete roster on screen.
    if (event.type === "keepalive") {
      if (
        event.presenceEpoch !== undefined &&
        presenceEpoch !== undefined &&
        event.presenceEpoch !== presenceEpoch
      ) {
        connection.reconnect();
      }
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
    // An activity frame (TASK-37): a new or deleted comment. No seq, no
    // log to catch up from — hand it to the listeners as it arrives.
    if (event.type === "activity") {
      host.onActivity(event);
      return;
    }
    // The server could not replay the whole gap (the delta was truncated):
    // only a snapshot can bring the board up to date.
    if (event.type === "resync") {
      const boardId = host.getActiveBoardId();
      if (boardId !== undefined) requestResync(boardId);
      return;
    }
    if (event.type !== "command") return;
    const boardId = boardIdOf(event);
    if (boardId === undefined) return;
    if (event.seq <= host.getBaseline(boardId)) return;
    if (host.isBusy(boardId) || resyncWanted.has(boardId)) {
      defer(boardId, event);
      return;
    }
    // A foreign event we would otherwise have to reorder (the ack of our
    // own later command beat it here): re-read the board instead.
    if (!process(event, false)) {
      defer(boardId, event);
      requestResync(boardId);
    }
  };

  // The tab's presence identity: stable across reconnects (a network blip
  // must not flicker the avatar) and unique per tab. Re-minted only if the
  // server says another holder already owns it (`client_id_taken`).
  let clientId = createClientId();

  // Presence heartbeat: the stream is one-way, so the tab refreshes its
  // session every 20 s (`PresenceService` sweeps at 60 s) and there is no
  // stale "online" dot to trust. A `410` means the session was swept while
  // we were throttled (A3): the stream is reopened to rejoin.
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pingBoard: string | null = null;
  const ping = (boardId: string | null): void => {
    const target = boardId ?? host.getActiveBoardId();
    if (target === undefined || target === null) return;
    void pingPresence(target, clientId).then((status) => {
      // A late `410` for a board we already left must not reopen the current
      // board's healthy stream (TASK-147 follow-up).
      if (status === 410 && target === watching) connection.reconnect();
    });
  };
  const startPing = (boardId: string): void => {
    pingBoard = boardId;
    if (pingTimer !== null) return;
    ping(boardId);
    pingTimer = setInterval(() => ping(pingBoard), PRESENCE_PING_MS);
  };
  const stopPing = (boardId?: string): void => {
    // A late `onDisconnected` of a board we already left must not stop the
    // heartbeat of the board we switched to (A11).
    if (boardId !== undefined && pingBoard !== boardId) return;
    pingBoard = null;
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
  };

  const connection = new BoardRealtime({
    open: (boardId, since, signal) =>
      openBoardEvents(boardId, since, signal, clientId),
    onEvent: handle,
    onConnected: startPing,
    onDisconnected: (boardId) => {
      // Live up to this moment: the idle clock starts now.
      host.markSynced(boardId);
      stopPing(boardId);
    },
    onFatal: (boardId, status) => {
      // A 403 from the stream is the membership check: the account is no
      // longer on the board (a reconnect after removal, or a direct URL).
      if (status === 403) host.onAccessRevoked(boardId);
      // TASK-103: a fatal 401 means the session is gone — tell the auth
      // layer so the app drops to login instead of following a dead stream
      // forever (the refresh already failed inside `openBoardEvents`).
      else if (status === 401) api.onAuthLost?.();
      // 404 is board-level and has its own path.
    },
    onClientIdTaken: () => {
      // Someone else holds our tab id: take a new one and rejoin. Not a
      // reason to drop the board.
      clientId = createClientId();
    },
    getSince: () => {
      const active = host.getActiveBoardId();
      return active === undefined ? 0 : host.getBaseline(active);
    },
  });

  const onOnline = (): void => connection.wakeNow();
  const onVisible = (): void => {
    // A background tab throttles timers: coming back is a fresh heartbeat.
    if (document.visibilityState === "visible") ping(pingBoard);
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  /** The board a deferred (snapshot-first) `watch` is waiting to open. */
  let pendingWatch: string | null = null;
  /** The board this bridge currently shows presence for. */
  let watching: string | null = null;

  const dropPresence = (boardId: string): void => {
    // The roster of a board we are leaving is stale: clear it instead of
    // leaving an "everyone online" list behind (A8).
    host.applyPresence(boardId, { type: "presence", op: "sync", users: [] });
    presenceEpoch = undefined;
  };

  return {
    watch: (boardId) => {
      if (pendingWatch === boardId) return;
      if (watching !== null && watching !== boardId) dropPresence(watching);
      watching = boardId;
      pendingWatch = null;
      // A board that has been idle for a while has a long backlog: replaying
      // it event by event costs one reducer pass and one render per event,
      // so read one snapshot first and resume the stream from its seq (U-9).
      const syncedAt = host.getSyncedAt(boardId);
      const idleMs = host.idleSnapshotMs ?? IDLE_SNAPSHOT_MS;
      if (syncedAt !== undefined && Date.now() - syncedAt > idleMs) {
        stopPing();
        connection.stop();
        pendingWatch = boardId;
        void host
          .refetch(boardId)
          .catch(() => "failed")
          .then(() => {
            if (pendingWatch !== boardId) return;
            pendingWatch = null;
            connection.watch(boardId);
          });
        return;
      }
      connection.watch(boardId);
    },
    stop: () => {
      pendingWatch = null;
      if (watching !== null) dropPresence(watching);
      watching = null;
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
      pendingWatch = null;
      if (watching !== null) dropPresence(watching);
      watching = null;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      stopPing();
      connection.stop();
      deferred.clear();
      resyncWanted.clear();
    },
  };
}
