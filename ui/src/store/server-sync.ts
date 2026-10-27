import type {
  BoardAction,
  CommandRequest,
  CommandResponse,
  EntityVersions,
} from "@janosik/shared";
import { ApiError } from "@/api/client";

/**
 * Outgoing command queue for one account (TASK-29).
 *
 * Every optimistic action travels through here: commands for a board are
 * sent strictly in dispatch order (one chain per board, one request in
 * flight at a time), so the server applies the same sequence the user saw.
 *
 * Quiet live edits (`UPDATE_CARD {quiet:true}`, one per keystroke) are
 * coalesced per card: only the newest patch is sent, after a short idle
 * window or as soon as anything else for the board (a move, undo, refetch)
 * needs a consistent server state. Superseded patches resolve as success —
 * their text never left the client and the coalesced undo step in the
 * history already covers the whole burst.
 */

/** Why a command did not land on the server. */
export type SendFailure =
  | { kind: "offline" }
  | { kind: "wip" }
  | { kind: "version" }
  /** `503 board_write_timeout` — the board was too busy; nothing was saved. */
  | { kind: "busy" }
  | { kind: "rejected"; status: number; field?: string };

export type SendOutcome =
  | { ok: true; versions: EntityVersions; seq: number }
  | { ok: false; failure: SendFailure };

export interface ServerSyncOptions {
  /** One `POST /boards/:id/commands` round-trip. */
  send: (boardId: string, request: CommandRequest) => Promise<CommandResponse>;
  /** Idle window before a coalesced quiet edit goes out on its own. */
  coalesceDelayMs?: number;
}

interface QuietEntry {
  boardId: string;
  action: BoardAction;
  waiters: Array<(outcome: SendOutcome) => void>;
  timer: ReturnType<typeof setTimeout>;
}

/** Coalesce a keystroke burst this long after the last keystroke. */
const DEFAULT_COALESCE_MS = 400;

/**
 * How many recently sent command ids are remembered per board for own-echo
 * detection (U-1). The echo of a command arrives within a round-trip or
 * two; even a long offline burst replays far fewer commands than this, and
 * the cap keeps a tab that stays open for days at a bounded footprint.
 */
export const SENT_IDS_PER_BOARD = 1_000;

function quietKey(boardId: string, action: BoardAction): string {
  const cardId = (action as { cardId?: string }).cardId ?? "";
  return `${boardId}:${cardId}`;
}

export class ServerSync {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly busy = new Map<string, number>();
  private readonly quiet = new Map<string, QuietEntry>();
  /** Insertion-ordered (oldest first) ids this client sent, per board. */
  private readonly sentIds = new Map<string, Set<string>>();
  private disposed = false;

  constructor(private readonly options: ServerSyncOptions) {}

  /**
   * Queue one command. Resolves when the server has answered (or the command
   * was superseded by a newer quiet patch for the same card).
   */
  enqueue(
    boardId: string,
    action: BoardAction,
    preconditions?: Record<string, number>,
  ): Promise<SendOutcome> {
    if (this.disposed) {
      return Promise.resolve({ ok: false, failure: { kind: "offline" } });
    }
    if (action.type === "UPDATE_CARD" && action.quiet === true) {
      return this.deferQuiet(boardId, action);
    }
    // Anything else must not overtake the text the user just typed.
    this.flushQuiet(boardId);
    return this.sendNow(boardId, action, preconditions);
  }

  /**
   * Send every coalesced quiet edit now — undo/redo, focus refetch and
   * logout need the server state to match the screen before they act.
   */
  flush(boardId?: string): void {
    if (boardId === undefined) {
      for (const key of [...this.quiet.keys()]) this.flushQuietKey(key);
      return;
    }
    this.flushQuiet(boardId);
  }

  /**
   * Flush every coalesced edit and wait (at most `timeoutMs`) for every
   * queued command to be answered — logout calls it before revoking the
   * session, so nothing the user typed is dropped with the queue (U-3).
   */
  async drain(timeoutMs = 3_000): Promise<void> {
    this.flush();
    const pending = Promise.all([...this.chains.values()]).then(
      () => undefined,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([pending, timeout]);
    clearTimeout(timer);
  }

  /**
   * Did this client send the command with this idempotency key? The
   * realtime bridge tells its own echoes apart by key, not by actor: one
   * account may run several writers at once (tabs, MCP agents on the same
   * personal key) and their commands must be applied (U-1).
   */
  wasSent(boardId: string, commandId: string): boolean {
    return this.sentIds.get(boardId)?.has(commandId) ?? false;
  }

  /** Are there queued, in-flight or coalesced commands for this board? */
  isBusy(boardId: string): boolean {
    if ((this.busy.get(boardId) ?? 0) > 0) return true;
    for (const entry of this.quiet.values()) {
      if (entry.boardId === boardId) return true;
    }
    return false;
  }

  /**
   * Cancel coalescing timers and refuse new work — the provider is going
   * away (logout unmounts it). React StrictMode's mount/cleanup/mount cycle
   * calls `revive()` right after, so the queue stays usable.
   */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.quiet.values()) clearTimeout(entry.timer);
    this.quiet.clear();
  }

  /** Accept commands again (StrictMode's second mount of the provider). */
  revive(): void {
    this.disposed = false;
  }

  private deferQuiet(
    boardId: string,
    action: BoardAction,
  ): Promise<SendOutcome> {
    return new Promise((resolve) => {
      const key = quietKey(boardId, action);
      const existing = this.quiet.get(key);
      if (existing !== undefined) {
        // Supersede: the newest patch wins, the older waiters are done.
        clearTimeout(existing.timer);
        for (const waiter of existing.waiters)
          waiter({ ok: true, versions: {}, seq: 0 });
        existing.action = action;
        existing.waiters.push(resolve);
        existing.timer = this.scheduleFlush(key);
        return;
      }
      const entry: QuietEntry = {
        boardId,
        action,
        waiters: [resolve],
        timer: this.scheduleFlush(key),
      };
      this.quiet.set(key, entry);
    });
  }

  private scheduleFlush(key: string): ReturnType<typeof setTimeout> {
    const delay = this.options.coalesceDelayMs ?? DEFAULT_COALESCE_MS;
    return setTimeout(() => this.flushQuietKey(key), delay);
  }

  private flushQuietKey(key: string): void {
    const entry = this.quiet.get(key);
    if (entry === undefined) return;
    this.quiet.delete(key);
    clearTimeout(entry.timer);
    // Quiet edits are last-write-wins per §7.0: no version preconditions are
    // attached (only undo/redo of text carries them).
    const outcome = this.sendNow(entry.boardId, entry.action);
    for (const waiter of entry.waiters) void outcome.then(waiter);
  }

  /** All coalesced quiet edits of one board, in one go. */
  private flushQuiet(boardId: string): void {
    for (const [key, entry] of this.quiet) {
      if (entry.boardId === boardId) this.flushQuietKey(key);
    }
  }

  private sendNow(
    boardId: string,
    action: BoardAction,
    preconditions?: Record<string, number>,
  ): Promise<SendOutcome> {
    this.bump(boardId, 1);
    // Remembered before the request leaves: the server echoes a command on
    // the stream before it answers the POST, so the echo may beat the ack.
    this.rememberSent(boardId, action);
    const chain = this.chains.get(boardId) ?? Promise.resolve();
    const run = chain.then(() => this.attempt(boardId, action, preconditions));
    this.chains.set(
      boardId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run.finally(() => this.bump(boardId, -1));
  }

  private async attempt(
    boardId: string,
    action: BoardAction,
    preconditions?: Record<string, number>,
  ): Promise<SendOutcome> {
    const request: CommandRequest = {
      commandId: (action as { commandId?: string }).commandId ?? "",
      action,
      ...(preconditions !== undefined
        ? { ifMatchVersions: preconditions }
        : {}),
    };
    try {
      const response = await this.options.send(boardId, request);
      return { ok: true, versions: response.versions, seq: response.seq };
    } catch (error) {
      return { ok: false, failure: classify(error) };
    }
  }

  private rememberSent(boardId: string, action: BoardAction): void {
    const commandId = (action as { commandId?: string }).commandId;
    if (commandId === undefined || commandId === "") return;
    let ids = this.sentIds.get(boardId);
    if (ids === undefined) {
      ids = new Set();
      this.sentIds.set(boardId, ids);
    }
    ids.add(commandId);
    if (ids.size > SENT_IDS_PER_BOARD) {
      // Sets iterate in insertion order: the first id is the oldest.
      const oldest = ids.values().next().value;
      if (oldest !== undefined) ids.delete(oldest);
    }
  }

  private bump(boardId: string, delta: number): void {
    const next = (this.busy.get(boardId) ?? 0) + delta;
    if (next <= 0) this.busy.delete(boardId);
    else this.busy.set(boardId, next);
  }
}

/** Map an API/transport error onto the sync layer's vocabulary. */
export function classify(error: unknown): SendFailure {
  if (error instanceof ApiError) {
    if (error.offline) return { kind: "offline" };
    if (error.conflict === "wip") return { kind: "wip" };
    if (error.conflict === "version") return { kind: "version" };
    // A transient refusal (the board's write lock timed out): rolled back
    // like any failure, but reported as "busy, try again", not "rejected".
    if (error.status === 503 && error.code === "board_write_timeout") {
      return { kind: "busy" };
    }
    return {
      kind: "rejected",
      status: error.status,
      ...(error.field !== undefined ? { field: error.field } : {}),
    };
  }
  return { kind: "rejected", status: 0 };
}

/**
 * The `touch` key of the entity whose *text* a command writes — the only
 * commands that carry version preconditions when undone (§7.0): undoing a
 * rename must not clobber a foreign edit, while positional changes stay
 * last-write-wins. Returns `null` for everything else.
 */
export function textEntityKey(
  boardId: string,
  action: BoardAction,
): string | null {
  const record = action as unknown as Record<string, unknown>;
  const id = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  switch (action.type) {
    case "UPDATE_CARD": {
      const cardId = id("cardId");
      return cardId === null ? null : `card:${cardId}`;
    }
    case "RENAME_COLUMN": {
      const columnId = id("columnId");
      return columnId === null ? null : `column:${columnId}`;
    }
    case "RENAME_BOARD":
      return `board:${boardId}`;
    case "RENAME_LABEL": {
      const labelId = id("labelId");
      return labelId === null ? null : `label:${labelId}`;
    }
    case "RENAME_CHECKLIST": {
      const checklistId = id("checklistId");
      return checklistId === null ? null : `checklist:${checklistId}`;
    }
    case "RENAME_CHECKLIST_ITEM": {
      const itemId = id("itemId");
      return itemId === null ? null : `checklistItem:${itemId}`;
    }
    default:
      return null;
  }
}
