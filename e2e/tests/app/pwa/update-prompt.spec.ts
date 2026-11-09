import type { Page } from "@playwright/test";
import { test, expect } from "@/fixtures/board.js";
import { appUrl } from "@/helpers/urls.js";
import {
  pwaBuildAvailable,
  serviceWorkerUrl,
  waitForServiceWorker,
} from "@/helpers/pwa.js";

test.skip(
  !pwaBuildAvailable,
  "PWA checks need the production self-host build under /app/ (see e2e/README.md).",
);

/**
 * A second deploy is simulated by registering the same worker script under a
 * revision query. The browser sees a different script URL, installs it and
 * leaves it waiting behind the active worker — exactly the state a real
 * deploy produces, without needing a second image.
 */
async function installWaitingWorker(
  page: Page,
  revision: string,
): Promise<void> {
  await page.evaluate(
    (url) => navigator.serviceWorker.register(url),
    `${serviceWorkerUrl}?e2e-update=${revision}`,
  );
  await page.waitForFunction(
    async (suffix) => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting?.scriptURL.includes(suffix) ?? false;
    },
    `e2e-update=${revision}`,
    { timeout: 20_000 },
  );
}

test("announces a waiting worker, applies it on reload and keeps a dismissal", async ({
  page,
  context,
  board,
}) => {
  await board.open(page);
  await waitForServiceWorker(page);
  const second = await context.newPage();
  await second.goto(appUrl);
  await expect(second.getByTestId("account-trigger")).toBeVisible();
  await waitForServiceWorker(second);

  await installWaitingWorker(page, "2");
  const prompt = page.getByTestId("update-prompt");
  await expect(prompt).toBeVisible();

  await prompt.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(prompt).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1_000);
  await expect(prompt).toBeHidden();

  await installWaitingWorker(page, "3");
  await expect(prompt).toBeVisible();
  const firstLoad = page.waitForEvent("load");
  const secondLoad = second.waitForEvent("load");
  // The handler reloads the document; a plain click would wait for an action
  // whose execution context disappears mid-navigation.
  await prompt
    .getByRole("button", { name: "Reload" })
    .evaluate((button) => (button as HTMLElement).click());
  await Promise.all([firstLoad, secondLoad]);

  const info = await waitForServiceWorker(page);
  expect(info.scriptURL).toContain("e2e-update=3");
  expect(info.controlled).toBe(true);
  const controller = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? "",
  );
  expect(controller).toContain("e2e-update=3");
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expect(second.getByTestId("account-trigger")).toBeVisible();
});
