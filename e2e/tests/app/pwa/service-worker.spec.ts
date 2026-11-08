import { test, expect } from "@/fixtures/board.js";
import {
  cachedRequestUrls,
  goOffline,
  goOnline,
  pwaBuildAvailable,
  pwaScope,
  serviceWorkerUrl,
  waitForServiceWorker,
  waitForShellCached,
} from "@/helpers/pwa.js";

/**
 * The production service worker (TASK-162.14): registration under the app
 * base, the install-time shell cache, the cache policy for the API and the
 * web-app manifest. Offline behaviour itself lives in `offline.spec.ts`.
 */

test.skip(
  !pwaBuildAvailable,
  "PWA checks need the production self-host build under /app/ (see e2e/README.md).",
);

test("registers the service worker for the app scope and controls the page", async ({
  page,
  board,
}) => {
  await board.open(page);

  const worker = await waitForServiceWorker(page);
  expect(worker.scope).toBe(pwaScope);
  expect(worker.scriptURL).toBe(serviceWorkerUrl);
  expect(worker.controlled).toBe(true);

  // A reload must keep the same worker in control (the shell is cached).
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  const afterReload = await waitForServiceWorker(page);
  expect(afterReload.scriptURL).toBe(serviceWorkerUrl);
  expect(afterReload.controlled).toBe(true);
});

test("serves the app shell and entry assets from cache on an offline boot", async ({
  page,
  context,
  board,
}) => {
  await board.open(page);
  await waitForServiceWorker(page);
  await waitForShellCached(page);

  await goOffline(context, page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });

    // The shell boots from the worker; the session bootstrap still needs the
    // API, so an offline reload lands on the sign-in screen (the documented
    // behaviour: only the shell is cached, boards require a connection).
    await expect(page.getByTestId("login-email")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("#root > *").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/app/board/${board.id}`);
  } finally {
    await goOnline(context, page);
  }
});

test("keeps API and event-stream responses out of the service worker cache", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "Cached-shell card");
  await board.open(page);
  await waitForServiceWorker(page);
  await waitForShellCached(page);
  // The board payload and its SSE handshake have definitely been requested.
  await expect(page.getByTestId("card-title")).toHaveText("Cached-shell card");

  const urls = await cachedRequestUrls(page);
  const paths = urls.map((url) => new URL(url).pathname);
  expect(paths).toContain(new URL(pwaScope).pathname);
  expect(paths.some((path) => path.startsWith("/api/"))).toBe(false);
});

test("serves the web app manifest and its icons under the app base", async ({
  page,
}) => {
  const manifestUrl = new URL("manifest.webmanifest", pwaScope).href;
  const response = await page.request.get(manifestUrl);
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    scope: string;
    icons: Array<{ src: string; sizes: string; type: string }>;
  };

  expect(manifest.name).toContain("Janosik");
  expect(manifest.display).toBe("standalone");
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(pwaScope);
  expect(new URL(manifest.scope, manifestUrl).href).toBe(pwaScope);
  expect(manifest.icons.length).toBeGreaterThan(0);

  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, manifestUrl).href;
    expect(
      new URL(iconUrl).pathname.startsWith(new URL(pwaScope).pathname),
    ).toBe(true);
    const iconResponse = await page.request.get(iconUrl);
    expect(iconResponse.status(), iconUrl).toBe(200);
    expect(iconResponse.headers()["content-type"], iconUrl).toContain(
      "image/png",
    );
  }
});
