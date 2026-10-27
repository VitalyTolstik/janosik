import type {
  BoardSseEvent,
  CommandSseEvent,
  ResyncSseEvent,
} from "@janosik/shared";
import type { InternalCommandEvent } from "@/realtime/realtime.service";
import type { CommandsService } from "./commands.service";

/**
 * The command half of an SSE stream — shared by the member stream
 * (`/boards/:id/events`) and the public live share (`/share/:token/events`).
 *
 * It guarantees the client sees the board's command log **exactly once, in
 * order, or is told to resync** — never a silent hole:
 *
 * 1. **Catch-up** (`start`): replays the delta since the client's `?since=`.
 *    Live frames that arrive meanwhile are parked and drained afterwards,
 *    deduplicated by `seq`.
 * 2. **Truncation** (B-3): when the delta cannot be replayed faithfully
 *    (`COMMAND_DELTA_MAX` hit, or the baseline was trimmed from the log), the
 *    client gets `{type:"resync"}` and must re-read the board snapshot; the
 *    stream then continues from the board's current head.
 * 3. **Contiguity** (B-4): every live frame carries `prevSeq` (internal). A
 *    frame whose `prevSeq` is not the last delivered seq means a frame was
 *    lost or reordered on the way (another node's publish arrived late, a
 *    Redis publish failed) — the stream re-reads the log from its last seq
 *    instead of delivering out of order or dropping.
 * 4. **Heartbeat** (`verifyCaughtUp`, on the keep-alive tick): if the log
 *    head is ahead of the stream with no frame in flight (a publish that
 *    never arrived and nothing after it), the gap is pulled from the log.
 */
export class CommandStreamSequencer {
  private lastSeq: number;
  private ready = false;
  private pulling = false;
  private pullAgain = false;
  private closed = false;
  private readonly parked: InternalCommandEvent[] = [];
  /** Frames a gap re-pull was already issued for (loop guard). */
  private readonly repulledFor = new Set<number>();

  constructor(
    private readonly commands: Pick<
      CommandsService,
      "deltaSince" | "latestSeq"
    >,
    private readonly boardId: string,
    since: number,
    private readonly emit: (event: BoardSseEvent) => void,
    private readonly fail: (error: unknown) => void,
  ) {
    this.lastSeq = since;
  }

  /** Kick off the initial catch-up. */
  start(): void {
    void this.pull();
  }

  /** Stop emitting (the subscriber went away). */
  close(): void {
    this.closed = true;
  }

  /** A live command frame from the bus. */
  offer(event: InternalCommandEvent): void {
    if (this.closed) return;
    if (!this.ready || this.pulling) {
      this.parked.push(event);
      return;
    }
    this.process(event);
  }

  /** Heartbeat check: pull from the log if its head is ahead of us. */
  async verifyCaughtUp(): Promise<void> {
    if (this.closed || !this.ready || this.pulling) return;
    const head = await this.commands.latestSeq(this.boardId);
    if (!this.closed && head > this.lastSeq) {
      await this.pull();
    }
  }

  private process(event: InternalCommandEvent): void {
    if (event.seq <= this.lastSeq) {
      this.repulledFor.delete(event.seq);
      return; // already delivered
    }
    if (
      event.prevSeq === undefined ||
      event.prevSeq === this.lastSeq ||
      // The log was already consulted for this very frame and still does
      // not explain its predecessor (e.g. that command's row was erased
      // with its author): deliver rather than re-pull forever.
      this.repulledFor.has(event.seq)
    ) {
      this.repulledFor.delete(event.seq);
      this.deliver(event);
      return;
    }
    // Something between our last seq and this frame never reached us (or
    // is still on its way from another node): the log is the authority.
    this.repulledFor.add(event.seq);
    this.parked.push(event);
    void this.pull();
  }

  private async pull(): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    try {
      do {
        this.pullAgain = false;
        const delta = await this.commands.deltaSince(
          this.boardId,
          this.lastSeq,
        );
        if (this.closed) return;
        if (delta.resync) {
          const head = await this.commands.latestSeq(this.boardId);
          if (this.closed) return;
          this.lastSeq = Math.max(this.lastSeq, head);
          this.emit({ type: "resync" } satisfies ResyncSseEvent);
        } else {
          for (const entry of delta.entries) {
            if (entry.seq > this.lastSeq) {
              this.deliver({ type: "command", ...entry });
            }
          }
        }
      } while (this.pullAgain && !this.closed);
      this.ready = true;
      this.pulling = false;
      this.drainParked();
    } catch (error) {
      this.pulling = false;
      if (!this.closed) this.fail(error);
    }
  }

  private drainParked(): void {
    if (this.parked.length === 0) return;
    const queue = this.parked.splice(0).sort((a, b) => a.seq - b.seq);
    for (const event of queue) {
      if (this.closed || this.pulling) {
        // A gap re-pull started mid-drain: park the rest for after it.
        this.parked.push(event);
        continue;
      }
      this.process(event);
    }
  }

  private deliver(event: InternalCommandEvent): void {
    this.lastSeq = event.seq;
    this.emit(toWire(event));
  }
}

/** The wire frame: exactly the shared `CommandSseEvent`, no internals. */
function toWire(event: InternalCommandEvent): CommandSseEvent {
  return {
    type: "command",
    seq: event.seq,
    action: event.action,
    actorId: event.actorId,
    ...(event.commandId !== undefined ? { commandId: event.commandId } : {}),
    touches: event.touches,
  };
}
