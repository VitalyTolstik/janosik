/**
 * Capture the tracked prototype at the three acceptance widths, both themes
 * and both role presets. Writes to pixel-parity/mockup-matrix/.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const out = path.resolve(import.meta.dirname, "..", "mockup-matrix");
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

async function shot(name) {
  await page
    .locator("#stage-body")
    .screenshot({ path: path.join(out, `${name}.png`) });
}

async function device(name) {
  await page.locator(`[data-action="device"][data-device="${name}"]`).click();
  await page.waitForTimeout(150);
}

async function preset(name) {
  await page
    .locator(`[data-action="role-preset"][data-preset="${name}"]`)
    .click();
  await page.waitForTimeout(120);
}

async function section(name) {
  await page.locator(`[data-action="section"][data-section="${name}"]`).click();
  await page.waitForTimeout(150);
}

async function ensureControlOpen() {
  if ((await page.locator(".ac-modal").count()) === 0) {
    const trigger = page.locator('[data-action="open-control"]');
    if (await trigger.count()) {
      await trigger.first().click();
      await page.waitForTimeout(150);
    }
  }
}

for (const deviceName of ["desktop", "tablet", "mobile"]) {
  await device(deviceName);
  let theme = "dark";
  for (const themeName of ["dark", "light"]) {
    if (theme !== themeName) {
      await page.locator("#theme-toggle").click();
      await page.waitForTimeout(150);
      theme = themeName;
    }
    for (const roleName of ["admin", "member"]) {
      await preset(roleName);
      await section("agents");
      await shot(`agents-attention-${roleName}-${themeName}-${deviceName}`);
      await page.locator("#agents-tab-sessions").click();
      await page.waitForTimeout(120);
      await shot(`agents-sessions-${roleName}-${themeName}-${deviceName}`);
      await page.locator("#agents-tab-runs").click();
      await page.waitForTimeout(120);
      await shot(`agents-runs-${roleName}-${themeName}-${deviceName}`);

      await section("control");
      await ensureControlOpen();
      if (roleName === "admin") {
        await page.locator("#ac-tab-inbox").click();
        await page.waitForTimeout(120);
        await shot(`control-inbox-${roleName}-${themeName}-${deviceName}`);
      }
      await page.locator("#ac-tab-live").click();
      await page.waitForTimeout(120);
      await shot(`control-live-${roleName}-${themeName}-${deviceName}`);
      await page.locator("#ac-tab-runs").click();
      await page.waitForTimeout(120);
      await shot(`control-runs-${roleName}-${themeName}-${deviceName}`);
      await page.locator("#ac-close").click();
      await page.waitForTimeout(120);
    }
  }
}

await browser.close();
console.log(`captured mockup matrix in ${out}`);
