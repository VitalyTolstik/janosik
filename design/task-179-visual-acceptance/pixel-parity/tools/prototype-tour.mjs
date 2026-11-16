/**
 * Drive the tracked design prototype with Playwright so every surface is
 * inspected as rendered, not from the HTML source.
 *
 * Usage:
 *   node design/task-179-visual-acceptance/pixel-parity/tools/prototype-tour.mjs
 *
 * The script writes screenshots and text dumps to
 * `design/task-179-visual-acceptance/pixel-parity/mockup/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "mockup");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1200 },
  deviceScaleFactor: 1,
  locale: "en-US",
});
await page.goto("http://127.0.0.1:5399/index.html", {
  waitUntil: "networkidle",
});
await page.waitForSelector(
  "#stage-body .agents-shell, #stage-body .board-scene",
);

async function stageShot(name) {
  const frame = page.locator("#stage-body");
  await frame.screenshot({ path: path.join(out, `${name}.png`) });
}

async function dump(name) {
  const body = await page.locator("#stage-body").innerHTML();
  await writeFile(path.join(out, `${name}.html`), body);
  const text = await page.locator("#stage-body").innerText();
  await writeFile(path.join(out, `${name}.txt`), text);
}

async function click(selector) {
  await page.locator(selector).first().click();
  await page.waitForTimeout(80);
}

// --- /agents -------------------------------------------------------------
await stageShot("agents-attention-default");
await dump("agents-attention-default");

await click("#agents-tab-sessions");
await stageShot("agents-sessions-default");
await dump("agents-sessions-default");

await click("#agents-tab-runs");
await stageShot("agents-runs-default");
await dump("agents-runs-default");

// Select the first run to capture the run detail footer and rollback.
const runRow = page.locator(".run-row").first();
if (await runRow.count()) {
  await runRow.click();
  await page.waitForTimeout(80);
  await stageShot("agents-runs-detail");
  await dump("agents-runs-detail");
}

// Attention approval detail + reject modal.
await click("#agents-tab-attention");
const review = page.locator('[data-action="select-approval"]').first();
if (await review.count()) {
  await review.click();
  await page.waitForTimeout(80);
  await stageShot("agents-attention-approval-detail");
  await dump("agents-attention-approval-detail");
}
const quickReject = page.locator('[data-action="quick-reject"]').first();
if (await quickReject.count()) {
  await quickReject.click();
  await page.waitForTimeout(80);
  await stageShot("agents-reject-dialog");
  await dump("agents-reject-dialog");
  await page.keyboard.press("Escape");
}

// Sessions detail (pause / end).
await click("#agents-tab-sessions");
const sessionRow = page.locator(".session-row").first();
if (await sessionRow.count()) {
  await sessionRow.click();
  await page.waitForTimeout(80);
  await stageShot("agents-session-detail");
  await dump("agents-session-detail");
  const pause = page.locator('[data-action="session-pause"]').last();
  if (await pause.count()) {
    await pause.click();
    await page.waitForTimeout(80);
    await stageShot("agents-session-pause-dialog");
    await dump("agents-session-pause-dialog");
    await page.keyboard.press("Escape");
  }
  const end = page.locator('[data-action="session-end"]').last();
  if (await end.count()) {
    await end.click();
    await page.waitForTimeout(80);
    await stageShot("agents-session-end-dialog");
    await dump("agents-session-end-dialog");
    await page.keyboard.press("Escape");
  }
}

// --- Agent control -------------------------------------------------------
await click('[data-action="section"][data-section="control"]');
await page.waitForTimeout(120);
const openControl = page.locator('[data-action="open-control"]');
if ((await openControl.count()) && !(await page.locator(".ac-modal").count())) {
  await openControl.first().click();
  await page.waitForTimeout(120);
}
await stageShot("control-inbox");
await dump("control-inbox");

await click("#ac-tab-live");
await stageShot("control-live");
await dump("control-live");

await click("#ac-tab-runs");
await stageShot("control-runs");
await dump("control-runs");

const acRun = page.locator(".ac-run-row").first();
if (await acRun.count()) {
  await acRun.click();
  await page.waitForTimeout(80);
  await stageShot("control-runs-detail");
  await dump("control-runs-detail");
}

await click("#ac-tab-inbox");
const acRow = page.locator(".ac-row").first();
if (await acRow.count()) {
  await acRow.click();
  await page.waitForTimeout(80);
  await stageShot("control-inbox-detail");
  await dump("control-inbox-detail");
}

// Reject / cancel request dialog in the inbox.
const cancel = page.locator('[data-action="cancel-approval"]').first();
if (await cancel.count()) {
  await cancel.click();
  await page.waitForTimeout(80);
  await stageShot("control-cancel-dialog");
  await dump("control-cancel-dialog");
  await page.keyboard.press("Escape");
}

// Mobile 390 preview for each surface.
await page.locator('[data-action="device"][data-device="mobile"]').click();
await page.waitForTimeout(160);
await click("#ac-tab-live");
await stageShot("control-live-390");
await click("#ac-tab-inbox");
await stageShot("control-inbox-390");
await click('[data-action="section"][data-section="agents"]');
await page.waitForTimeout(160);
await stageShot("agents-attention-390");
await click("#agents-tab-sessions");
await stageShot("agents-sessions-390");
await click("#agents-tab-runs");
await stageShot("agents-runs-390");

// Light theme desktop.
await page.locator('[data-action="device"][data-device="desktop"]').click();
await page.locator("#theme-toggle").click();
await page.waitForTimeout(120);
await stageShot("agents-runs-light");
await click('[data-action="section"][data-section="control"]');
await page.waitForTimeout(120);
const openControlLight = page.locator('[data-action="open-control"]');
if (
  (await openControlLight.count()) &&
  !(await page.locator(".ac-modal").count())
) {
  await openControlLight.first().click();
  await page.waitForTimeout(120);
}
await click("#ac-tab-live");
await stageShot("control-live-light");

await browser.close();
console.log(`wrote prototype evidence to ${out}`);
