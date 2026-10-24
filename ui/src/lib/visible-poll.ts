/**
 * Poll `tick` on an interval, but only while the tab is visible **and** the
 * window has focus. `visibilitychange` alone is not enough: switching to
 * another window leaves the tab "visible" (`document.hidden === false`), so a
 * background admin tab would keep polling forever. Pausing on `blur` keeps
 * the API quiet the moment the operator looks away, and `focus` resumes it.
 *
 * One fetch always runs on mount — the first paint needs data, and a window
 * that is not focused yet (a background tab, or the test environment) must
 * still show content. Only the repeating timer is gated on visibility/focus.
 *
 * Returns a cleanup that stops the timer and removes the listeners.
 */
export function pollWhileFocused(
  tick: () => void,
  intervalMs: number,
): () => void {
  let id: ReturnType<typeof setInterval> | null = null;

  const active = (): boolean =>
    !document.hidden &&
    document.hasFocus() &&
    document.visibilityState === "visible";

  const sync = (): void => {
    if (active()) {
      if (id === null) id = setInterval(tick, intervalMs);
    } else if (id !== null) {
      clearInterval(id);
      id = null;
    }
  };

  tick();
  sync();
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);

  return () => {
    if (id !== null) clearInterval(id);
    id = null;
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
  };
}
