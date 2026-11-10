/**
 * Registers the PWA service worker. Production-only and no-op when the
 * environment (or browser) does not support service workers, so dev
 * servers and jsdom tests are unaffected.
 *
 * TASK-151 (C5): the worker no longer applies an update on its own. A new
 * deploy installs as `waiting`; we announce it on this window and
 * `UpdatePrompt` decides when to post `SKIP_WAITING` and reload. Applying
 * the update while an old tab is open used to break that tab's lazy chunks.
 *
 * TASK-156: `clients.claim()` makes the fresh worker take over every open
 * tab. Until now only the tab that clicked "Reload" reloaded; the others
 * kept running the old bundle against the new worker. Every tab therefore
 * reloads once on its own `controllerchange` (only if it already had a
 * controller — the first install must not reload), and a failed lazy chunk
 * import raises the same update prompt.
 *
 * TASK-156 review: an update is announced once per waiting worker
 * instance. The focus/visibility refresh used to re-announce the same
 * waiting worker on every focus, so a dismissed banner kept coming back;
 * only a *different* waiting worker (a newer deploy) is news again.
 */
export const UPDATE_EVENT = "janosik:update-available";

/**
 * How long the click waits for `controllerchange`. The event normally fires
 * within a frame or two; the bound only covers a worker that is already
 * active (and therefore emits no change event) so the button never looks
 * dead.
 */
const CONTROLLER_CHANGE_TIMEOUT_MS = 3_000;

let reloading = false;
let reloadTimer: number | undefined;
/** The waiting worker whose availability was already announced. */
let announced: ServiceWorker | null = null;

/**
 * Reload this tab exactly once. Shared by `controllerchange` and the
 * fallback timer: `reloading` makes a repeated click or a second change
 * event a no-op instead of a reload loop.
 */
function reloadOnce(): void {
  if (reloadTimer !== undefined) {
    window.clearTimeout(reloadTimer);
    reloadTimer = undefined;
  }
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const announce = (): void => {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  };
  /** Deduplicated announcement: once per waiting worker instance. */
  const announceWorker = (worker: ServiceWorker): void => {
    if (worker === announced) return;
    announced = worker;
    announce();
  };
  const hadController = navigator.serviceWorker.controller !== null;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    reloadOnce();
  });

  // A dynamic import that the new worker cannot answer (the chunk was never
  // cached and the server replied with `index.html`) is recoverable by
  // applying the waiting update. Without a waiting worker there is nothing to
  // apply — an offline idle prefetch, for example — and a "new version"
  // banner would only be misleading.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    // An emergency, not a routine announcement: the running bundle just
    // broke, so the prompt is raised even when this worker was announced
    // (and dismissed) before.
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration?.waiting) announce();
      })
      .catch(() => {
        /* the registration is unreachable — nothing to apply */
      });
  });

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((registration) => {
      const checkWaiting = (): void => {
        const waiting = registration.waiting;
        if (waiting && navigator.serviceWorker.controller) {
          announceWorker(waiting);
        }
      };
      // An update already waiting when this page loads.
      checkWaiting();
      const watchInstalling = (): void => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            announceWorker(worker);
          }
        });
      };
      watchInstalling();
      registration.addEventListener("updatefound", watchInstalling);

      // Poll on focus/visibility: a tab that stayed open without focus must
      // still learn about a deploy (the one-shot `updatefound` is not
      // enough), and `statechange` can be missed during startup. The
      // refresh announces only a new/different waiting worker — a dismissed
      // banner stays dismissed (TASK-156 review).
      const refresh = (): void => {
        void registration
          .update()
          .then(() => checkWaiting())
          .catch(() => {
            /* offline — the next focus retries */
          });
      };
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refresh();
      });
    })
    .catch(() => {
      /* registration failures (e.g. insecure context) must not break the app */
    });
}

/**
 * Ask the waiting worker to activate, then reload into the new build.
 * With no waiting worker there is nothing to apply — the banner outlived
 * the worker (activated elsewhere, or the registration was replaced) —
 * and reloading anyway would drop the user's in-flight edits for nothing
 * (TASK-156 review): refresh the registration instead and let a real
 * waiting worker announce itself again.
 *
 * The reload is driven by `controllerchange`, not started right after
 * `postMessage`. Activating the new worker terminates the old one, and a
 * navigation started against the old controller could be aborted, leaving
 * the tab on the old build with the banner still up (observed in CI). The
 * event fires only once the new worker controls this tab, so the reload
 * lands on the new build; the bounded timer covers the already-active edge
 * case where no change event follows.
 */
export function applyServiceWorkerUpdate(): void {
  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      const waiting = registration?.waiting;
      if (!waiting) {
        void registration?.update().catch(() => undefined);
        return;
      }
      waiting.postMessage({ type: "SKIP_WAITING" });
      reloadTimer = window.setTimeout(reloadOnce, CONTROLLER_CHANGE_TIMEOUT_MS);
    })
    .catch(() => {
      /* the registration is unreachable — nothing to apply */
    });
}
