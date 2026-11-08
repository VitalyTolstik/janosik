import { expect, type BrowserContext, type Page } from "@playwright/test";

import { appUrl } from "./urls.js";

/**
 * Helpers for the production PWA surface (TASK-162.14). The service worker
 * exists only in a built bundle; the self-host image serves the app under
 * `/app/`, which is also the worker's scope.
 */

/** The app deploy base, always slash-terminated (`.../app/`). */
export const pwaScope = (() => {
  const url = new URL(appUrl);
  return `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
})();

/** Absolute URL of the stamped service worker. */
export const serviceWorkerUrl = new URL("sw.js", pwaScope).href;

/**
 * True when the suite points at the production self-host layout.
 *
 * Path-only on purpose: the shipped Compose image serves the app at `/app/`,
 * and the suite pins that layout. A standalone production build at `/` also
 * registers a worker, but silently running the checks there would hide a
 * deploy-base regression, so the skip is explicit in the run report.
 */
export const pwaBuildAvailable = new URL(appUrl).pathname.endsWith("/app/");

export interface ServiceWorkerInfo {
  scope: string;
  scriptURL: string;
  controlled: boolean;
}

/**
 * Wait for the registered worker to activate and control this page. The
 * first visit is claimed by `clients.claim()`; the explicit controller wait
 * also covers the short window between activation and claim, and fails with
 * a useful timeout instead of a stale `null` when registration is broken.
 */
export async function waitForServiceWorker(
  page: Page,
): Promise<ServiceWorkerInfo> {
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active != null;
    },
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are unavailable");
    }
    const registration = await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error("Service worker did not claim the page")),
          15_000,
        );
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    return {
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL ?? "",
      controlled: navigator.serviceWorker.controller !== null,
    };
  });
}

/** Every request URL the page's Cache Storage currently holds. */
export async function cachedRequestUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

/**
 * Wait until `install` precached the shell and the entry assets. The first
 * offline reload is only meaningful once both are there.
 */
export async function waitForShellCached(page: Page): Promise<void> {
  const shellPath = new URL(pwaScope).pathname;
  const assetsPath = new URL("assets/", pwaScope).pathname;
  await expect
    .poll(
      async () => {
        const urls = await cachedRequestUrls(page);
        const paths = urls.map((url) => new URL(url).pathname);
        return {
          shell: paths.includes(shellPath),
          entryAsset: paths.some(
            (path) => path.startsWith(assetsPath) && path.endsWith(".js"),
          ),
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({ shell: true, entryAsset: true });
}

/** Cut the browser off and make sure the page saw `navigator.onLine=false`. */
export async function goOffline(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.setOffline(true);
  await expect
    .poll(() => page.evaluate(() => navigator.onLine), { timeout: 10_000 })
    .toBe(false);
}

/** Restore the network and wait for the matching `online` window event. */
export async function goOnline(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.setOffline(false);
  await expect
    .poll(() => page.evaluate(() => navigator.onLine), { timeout: 10_000 })
    .toBe(true);
}
