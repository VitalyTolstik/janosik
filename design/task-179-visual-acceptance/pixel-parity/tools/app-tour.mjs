/**
 * Capture the current app for the TASK-179 pixel-parity stream.
 *
 * Prereqs:
 *   disposable DB seeded by scripts/seed-agent-pixel-demo.mjs
 *   API on 5302, Vite UI on 5301 with UI_API_PROXY=http://127.0.0.1:5302
 *
 * Usage:
 *   node design/task-179-visual-acceptance/pixel-parity/tools/app-tour.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "app-before");
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:5301";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "en-US",
  colorScheme: "dark",
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error("[console]", message.text());
});
page.on("pageerror", (error) => console.error("[pageerror]", error.message));

async function login(email = "pixel-admin@example.com") {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  if (await page.getByTestId("login-email").count()) {
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill("pixel-demo-password");
    await page.getByTestId("login-submit").click();
  }
  await page.waitForTimeout(1500);
  if (await page.getByTestId("login-error").count()) {
    console.error(
      "login error",
      await page.getByTestId("login-error").innerText(),
    );
  }
}

async function go(pathname) {
  await page.goto(`${base}${pathname}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

async function shot(name) {
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    fullPage: false,
  });
  await writeFile(
    path.join(out, `${name}.txt`),
    await page.locator("body").innerText(),
  );
}

await login();
await go("/agents");
await shot("agents-attention-1440-dark");

await page.getByTestId("agents-section-sessions").click();
await page.waitForTimeout(500);
await shot("agents-sessions-1440-dark");

await page.getByTestId("agents-section-runs").click();
await page.waitForTimeout(900);
await shot("agents-runs-1440-dark");

const runRows = page.locator('[data-testid^="agent-run-row-"]');
if (await runRows.count()) {
  await runRows.nth(1).click();
  await page.waitForTimeout(1200);
  await shot("agents-run-detail-1440-dark");
}
if (await page.locator('[data-testid="agent-run-detail"]').count()) {
  await page
    .locator('[data-testid="agent-run-detail"] .overflow-y-auto')
    .last()
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await page.waitForTimeout(300);
  await shot("agents-run-detail-bottom-1440-dark");
}

await page.getByTestId("agents-section-attention").click();
await page.waitForTimeout(400);
const review = page.getByRole("button", { name: "Review plan" }).first();
if (await review.count()) {
  await review.click();
  await page.waitForTimeout(500);
  await shot("agents-approval-detail-1440-dark");
  await page
    .locator('[data-testid="agents-approval-detail"] .overflow-y-auto')
    .last()
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await page.waitForTimeout(300);
  await shot("agents-approval-detail-bottom-1440-dark");
  if (await page.getByTestId("approval-reject").count()) {
    await page.getByTestId("approval-reject").click();
    await page.waitForTimeout(200);
    await shot("agents-approval-reject-form-1440-dark");
    await page.getByRole("button", { name: "Cancel" }).last().click();
  }
}

await page.getByTestId("agents-section-sessions").click();
await page.waitForTimeout(400);
const sessionRows = page.locator('[data-testid^="agent-session-row-"]');
if (await sessionRows.count()) {
  await sessionRows.first().click();
  await page.waitForTimeout(500);
  await shot("agents-session-detail-1440-dark");
  const pause = page.getByTestId("agents-session-pause");
  if (await pause.count()) {
    await pause.click();
    await page.waitForTimeout(400);
    await shot("agents-session-pause-dialog-1440-dark");
    await page.keyboard.press("Escape");
  }
  const end = page.getByTestId("agents-session-end");
  if (await end.count()) {
    await end.click();
    await page.waitForTimeout(400);
    await shot("agents-session-end-dialog-1440-dark");
    await page.keyboard.press("Escape");
  }
}

// Board-scoped agent control.
await go("/board/px-board-agent-ops");
await page.waitForTimeout(700);
await page.getByTestId("agent-control-trigger").click();
await page.waitForTimeout(700);
await shot("control-inbox-1440-dark");

await page.getByTestId("agent-approvals-tab").click();
await page.waitForTimeout(400);
const approvalRows = page.locator('[data-testid^="approval-row-"]');
if (await approvalRows.count()) {
  await approvalRows.first().click();
  await page.waitForTimeout(500);
  await shot("control-inbox-detail-1440-dark");
}

await page.getByTestId("agent-pause-tab").click();
await page.waitForTimeout(700);
await shot("control-live-1440-dark");

await page.getByTestId("agent-runs-tab").click();
await page.waitForTimeout(900);
await shot("control-runs-1440-dark");
await page
  .locator('[data-testid="agent-run-detail"] .overflow-y-auto')
  .last()
  .evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
await page.waitForTimeout(300);
await shot("control-runs-detail-bottom-1440-dark");

await browser.close();
console.log(`wrote app-before evidence to ${out}`);
