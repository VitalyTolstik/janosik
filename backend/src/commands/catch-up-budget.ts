/**
 * Process-wide admission budget for SSE catch-up replay (TASK-200.13).
 *
 * A reconnect can ask for up to the command delta cap. Loading those rows
 * concurrently for thousands of streams would multiply the transient
 * payload/detail memory even though the SSE frames themselves are shared.
 * This budget bounds both the number of catch-ups actually reading rows and
 * the estimated bytes they hold at once; a caller that cannot get a slot
 * answers `resync` instead of starting another page scan. The reservation is
 * released only after the sequencer has emitted the returned entries, not
 * when `deltaSince` returns.
 */
export const CATCH_UP_MAX_BYTES = 32 * 1024 * 1024;
export const CATCH_UP_MAX_IN_FLIGHT = 6;

export class CatchUpBudget {
  private inFlight = 0;
  private reservedBytes = 0;

  constructor(
    private readonly maxBytes: number = CATCH_UP_MAX_BYTES,
    private readonly maxInFlight: number = CATCH_UP_MAX_IN_FLIGHT,
  ) {}

  /** Reserve one catch-up slot for the whole estimate + page loop. */
  tryBegin(): (() => void) | null {
    if (this.inFlight >= this.maxInFlight) return null;
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
    };
  }

  /**
   * Reserve the estimated transient bytes for one catch-up. A delta larger
   * than the whole budget can never run; a fair scheduler is not needed for
   * a resumable stream — the client full-refreshes instead.
   */
  tryReserve(bytes: number): (() => void) | null {
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes > this.maxBytes || this.reservedBytes + bytes > this.maxBytes) {
      return null;
    }
    this.reservedBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reservedBytes = Math.max(0, this.reservedBytes - bytes);
    };
  }

  /** Diagnostics for tests/observability. */
  get activeCatchUps(): number {
    return this.inFlight;
  }

  get activeBytes(): number {
    return this.reservedBytes;
  }
}

/**
 * One budget per API process (all `CommandsService` instances share it);
 * tests may inject their own `CatchUpBudget` instance.
 */
export const processCatchUpBudget = new CatchUpBudget();
