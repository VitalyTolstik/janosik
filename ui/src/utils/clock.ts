/**
 * One clock for every due badge (TASK-156).
 *
 * A badge used to own a `setInterval` plus two window/document listeners, so
 * a 2400-card board kept thousands of timers alive. They all only need the
 * same minute tick, so the store keeps one timer and one pair of listeners
 * and fans the tick out to its subscribers.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let current = Date.now();
let interval: ReturnType<typeof setInterval> | null = null;

function bump(): void {
  current = Date.now();
  for (const listener of [...listeners]) listener();
}

function ensureRunning(): void {
  if (interval !== null) return;
  interval = setInterval(bump, 60_000);
  const onVisible = (): void => {
    if (document.visibilityState === "visible") bump();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", bump);
}

export function subscribeClock(listener: Listener): () => void {
  if (listeners.size === 0) {
    // The first subscriber after a long idle must not read a stale
    // `current` (TASK-156 review): the module may have loaded hours ago
    // while no badge was on screen, and the first tick is a minute away.
    // Re-stamp directly — waking the whole listener set (a `bump()`)
    // would re-render every already-mounted badge for nothing.
    current = Date.now();
  }
  listeners.add(listener);
  ensureRunning();
  return () => {
    listeners.delete(listener);
  };
}

export function getClockNow(): number {
  return current;
}
