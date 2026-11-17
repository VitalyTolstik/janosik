/**
 * Read the tracked prototype's computed styles for the pixel-parity matrix.
 * Writes pixel-parity/mockup-measurements.json.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const out = path.resolve(import.meta.dirname, "..", "mockup-measurements.json");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1200 },
  deviceScaleFactor: 1,
});
await page.goto("http://127.0.0.1:5399/index.html", {
  waitUntil: "networkidle",
});
await page.waitForSelector("#stage-body .agents-shell");
const result = {};

async function measure(key, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return;
  result[key] = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      text: (element.textContent ?? "").trim().slice(0, 80),
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color,
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      padding: style.padding,
      gap: style.gap,
      icon: element.querySelector("svg")
        ? (() => {
            const icon = element.querySelector("svg");
            const rect = icon.getBoundingClientRect();
            return {
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            };
          })()
        : null,
    };
  });
}

await page.waitForTimeout(200);
await measure("agentsRail", ".agents-rail");
await measure("agentsMain", ".agents-main");
await measure("agentsDetail", ".agents-detail");
await measure("pageTitle", ".page-head h1");
await measure("pageSubtitle", ".page-head p");
await measure("refresh", ".page-head-actions .btn");
await measure("search", ".agents-toolbar .input");
await measure("approvalCard", ".approval-card");
await measure("sessionRow", ".session-row");
await measure("globalRunRow", ".run-row");

// Global run detail footer.
await page.locator("#agents-tab-runs").click();
await page.waitForTimeout(150);
await measure("globalRunRow", ".run-row");
await page.locator(".run-row").first().click();
await page.waitForTimeout(150);
await measure("runHeader", ".agents-detail .detail-head");
await measure("runFooter", ".agents-detail .detail-foot");
await measure("runFooterOpen", ".agents-detail .detail-foot .btn-outline");
await measure("runFooterCopy", ".agents-detail .detail-foot .btn-ghost");

// Global approval detail footer.
await page.locator("#agents-tab-attention").click();
await page.waitForTimeout(150);
await measure("approvalCard", ".approval-card");
await page.locator('[data-action="select-approval"]').first().click();
await page.waitForTimeout(150);
await measure("approvalFooter", ".agents-detail .detail-foot");
await measure(
  "approvalReject",
  '.agents-detail .detail-foot [data-action="reject-start"]',
);
await measure(
  "approvalApprove",
  '.agents-detail .detail-foot [data-action="approve-start"]',
);
await page
  .locator('.agents-detail .detail-foot [data-action="reject-start"]')
  .click();
await page.waitForTimeout(150);
await measure("approvalRejectForm", ".agents-detail .reject-form");
await measure("approvalRejectLabel", ".agents-detail .reject-form label");
await measure("approvalRejectTextarea", ".agents-detail .reject-form textarea");
await measure(
  "approvalRejectCancel",
  '.agents-detail .reject-form [data-action="reject-cancel"]',
);
await measure(
  "approvalRejectConfirm",
  '.agents-detail .reject-form [data-action="reject-submit"]',
);
await page
  .locator('.agents-detail .reject-form [data-action="reject-cancel"]')
  .click();
await page.waitForTimeout(100);

// Session pause dialog.
await page.locator("#agents-tab-sessions").click();
await page.waitForTimeout(150);
await measure("sessionRow", ".session-row");
await page.locator(".session-row").first().click();
await page.waitForTimeout(150);
await page
  .locator('.agents-detail .detail-foot [data-action="session-pause"]')
  .click();
await page.waitForTimeout(200);
await measure("pauseDialog", ".dialog");
await measure("pauseTitle", ".dialog .dialog-head h2");
await measure("pauseDescription", ".dialog .dialog-head p");
await measure("pauseReason", ".dialog .dialog-body textarea");
await measure(
  "pauseCancel",
  '.dialog .dialog-foot [data-action="dialog-cancel"]',
);
await measure(
  "pauseConfirm",
  '.dialog .dialog-foot [data-action="dialog-confirm"]',
);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// Board run list row.
await page.locator('[data-action="section"][data-section="control"]').click();
await page.waitForTimeout(150);
if ((await page.locator(".ac-modal").count()) === 0) {
  await page.locator('[data-action="open-control"]').first().click();
  await page.waitForTimeout(150);
}
await page.locator("#ac-tab-runs").click();
await page.waitForTimeout(150);
await measure("boardRunRow", ".ac-run-row");
await measure("boardRunsHeader", ".ac-toolbar");

// Board approval footer.
await page.locator("#ac-tab-inbox").click();
await page.waitForTimeout(150);
await page.locator(".ac-row").first().click();
await page.waitForTimeout(150);
await measure("boardApprovalFooter", ".ac-foot");
await measure("boardApprovalReject", '.ac-foot [data-action="reject-start"]');
await measure("boardApprovalApprove", '.ac-foot [data-action="approve-start"]');
await measure("boardApprovalCancel", ".ac-detail-head .icon-btn-sm");

// Live card and row actions.
await page.locator("#ac-tab-live").click();
await page.waitForTimeout(150);
await measure("liveCard", ".live-status-card");
await measure("livePauseAll", ".live-status-card .btn-danger-outline");
await measure("liveRowPause", ".live-session-actions .btn");
await measure("liveRowEnd", ".live-session-actions .icon-btn-sm");

await writeFile(out, JSON.stringify(result, null, 2));
await browser.close();
console.log(`wrote ${out}`);
