import type { Logger } from "@nestjs/common";

/** One reconciliation at a time, without making process startup wait on Redis. */
export class ReconcileLoop {
  private timer?: NodeJS.Timeout;
  private trailing?: Promise<void>;
  private stopped = false;
  private running?: Promise<void>;

  constructor(
    private readonly logger: Logger,
    private readonly reconcile: () => Promise<void>,
  ) {}

  start(intervalMs: number): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), intervalMs);
    this.timer.unref();
  }

  run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.reconcile()
      .catch((error: unknown) => {
        this.logger.warn(`Reconciliation failed: ${String(error)}`);
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  /** Queue one trailing read after a change made during an active pass. */
  refresh(): Promise<void> {
    if (!this.running) return this.run();
    this.trailing ??= this.running.then(() => {
      this.trailing = undefined;
      return this.run();
    });
    return this.trailing;
  }

  stop(): Promise<void> | undefined {
    this.stopped = true;
    clearInterval(this.timer);
    return this.running;
  }
}
