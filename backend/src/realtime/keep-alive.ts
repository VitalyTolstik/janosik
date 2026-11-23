/**
 * A self-rescheduling keep-alive timer for one SSE stream (TASK-200.5).
 *
 * Why not `setInterval`:
 * - **Jitter.** 3 000 streams opened together would otherwise tick together
 *   every 25 s and fire one synchronized burst of validation queries. The
 *   first delay and every later delay get `[0, jitterMs]` of spread.
 * - **Overlap guard.** If one tick's database checks take longer than the
 *   interval, `setInterval` would stack another tick on top of it; with a
 *   slow pool that snowballs. This scheduler skips a beat while the previous
 *   task is still running and resumes on the next delay.
 * - **Clean shutdown.** `stop()` clears the one pending timer and makes sure
 *   an in-flight task cannot schedule another one, so closing the stream (or
 *   the app) leaves no timer/listener behind.
 *
 * One instance owns exactly one timer; `start()` is idempotent.
 */
export interface KeepAliveOptions {
  baseMs: number;
  jitterMs: number;
  task: () => void | Promise<void>;
  /** Injectable clock source for deterministic tests. */
  random?: () => number;
  /** Called when a tick is skipped because the previous one is running. */
  onSkip?: () => void;
}

/** `baseMs` + uniform `[0, jitterMs]`, never below the base. */
export function keepAliveDelay(
  baseMs: number,
  jitterMs: number,
  random: () => number = Math.random,
): number {
  const jitter = Math.max(0, Math.floor(jitterMs));
  if (jitter === 0) return baseMs;
  return baseMs + Math.min(jitter, Math.floor(random() * (jitter + 1)));
}

export class KeepAliveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private started = false;

  constructor(private readonly options: KeepAliveOptions) {}

  /** Arm the first tick. Idempotent: a second call is a no-op. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule();
  }

  /** Cancel the timer and prevent an in-flight tick from rescheduling. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Is a task currently awaited? — tests/diagnostics. */
  get tickInFlight(): boolean {
    return this.running;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = keepAliveDelay(
      this.options.baseMs,
      this.options.jitterMs,
      this.options.random,
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, delay);
  }

  private fire(): void {
    if (this.stopped) return;
    // Keep a steady cadence: the next beat is armed before the work starts.
    // If this work is still running then, the beat is skipped rather than
    // stacked, and the following one is still on time.
    this.schedule();
    if (this.running) {
      this.options.onSkip?.();
      return;
    }
    this.running = true;
    void Promise.resolve()
      .then(() => this.options.task())
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
      });
  }
}
