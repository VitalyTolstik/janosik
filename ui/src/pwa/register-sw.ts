/**
 * Registers the PWA service worker. Production-only and no-op when the
 * environment (or browser) does not support service workers, so dev
 * servers and jsdom tests are unaffected.
 *
 * TASK-151 (C5): the worker no longer applies an update on its own. A new
 * deploy installs as `waiting`; we announce it on this window and
 * `UpdatePrompt` decides when to post `SKIP_WAITING` and reload. Applying
 * the update while an old tab is open used to break that tab's lazy chunks.
 */
export const UPDATE_EVENT = "janosik:update-available";

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const announce = (): void => {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  };
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((registration) => {
      // An update already waiting when this page loads.
      if (registration.waiting && navigator.serviceWorker.controller) {
        announce();
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            announce();
          }
        });
      });
    })
    .catch(() => {
      /* registration failures (e.g. insecure context) must not break the app */
    });
}

/** Ask the waiting worker to activate, then reload into the new build. */
export function applyServiceWorkerUpdate(): void {
  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
    })
    .catch(() => window.location.reload());
}
