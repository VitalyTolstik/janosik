/**
 * Registers the PWA service worker. Production-only and no-op when the
 * environment (or browser) does not support service workers, so dev
 * servers and jsdom tests are unaffected.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .catch(() => {
      /* registration failures (e.g. insecure context) must not break the app */
    });
}
