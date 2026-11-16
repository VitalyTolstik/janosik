/**
 * Read the app's computed styles for the pixel-parity comparison.
 * Prereqs: disposable stack + seed + UI on 5301.
 * Writes pixel-parity/app-measurements.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "app-measurements.json");
const base = "http://127.0.0.1:5301";
const browser = await chromium.launch({ headless: true });
const result = {};

async function pageAt(width = 1440, height = 900) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.getByTestId("login-email").fill("pixel-admin@example.com");
  await page.getByTestId("login-password").fill("pixel-demo-password");
  await page.getByTestId("login-submit").click();
  await page.waitForTimeout(1200);
  await page.goto(`${base}/agents?section=attention`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1800);
  return { context, page };
}

async function measure(page, key, selector) {
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

const { context, page } = await pageAt();

await measure(page, "rail", '[data-testid="agents-page"] > aside');
await measure(page, "main", "#agents-panel");
await measure(page, "detail", '[data-testid="agents-detail-panel"]');
await measure(page, "railTab", '[data-testid="agents-section-attention"]');
await measure(page, "pageTitle", "#agents-panel h2");
await measure(page, "pageSubtitle", "#agents-panel h2 + p");
await measure(page, "refresh", '[data-testid="agents-refresh"]');
await measure(page, "search", '[data-testid="agents-search"]');
await measure(page, "approvalCard", '[data-testid="agents-approvals"] article');
await measure(page, "approvalStatus", '[data-testid="approval-row-status"]');
await measure(
  page,
  "approvalFooter",
  '[data-testid="agents-approval-detail"] footer',
);
await measure(page, "approvalReject", '[data-testid="approval-reject"]');
await measure(page, "approvalApprove", '[data-testid="approval-approve"]');

await page
  .locator('[data-testid^="agents-approval-review-"]')
  .first()
  .click()
  .catch(() => undefined);
await page.waitForTimeout(400);
await measure(
  page,
  "approvalFooter",
  '[data-testid="agents-approval-detail"] footer',
);
await measure(page, "approvalReject", '[data-testid="approval-reject"]');
await measure(page, "approvalApprove", '[data-testid="approval-approve"]');
if ((await page.getByTestId("approval-reject").count()) > 0) {
  await page.getByTestId("approval-reject").click();
  await page.waitForTimeout(200);
  await measure(
    page,
    "approvalRejectForm",
    '[data-testid="agents-approval-detail"] form',
  );
  await measure(
    page,
    "approvalRejectLabel",
    '[data-testid="agents-approval-detail"] form label',
  );
  await measure(
    page,
    "approvalRejectTextarea",
    '[data-testid="approval-comment"]',
  );
  await measure(
    page,
    "approvalRejectConfirm",
    '[data-testid="approval-confirm"]',
  );
}

await page.goto(`${base}/agents?section=sessions`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(900);
await measure(page, "sessionRow", '[data-testid^="agent-session-row-"]');
await measure(
  page,
  "sessionTableHead",
  '[data-testid="agents-session-table-head"]',
);

await page.goto(`${base}/agents?section=runs`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1600);
await measure(page, "globalRunRow", '[data-testid^="agents-run-row-"]');
await measure(page, "runFooter", '[data-testid="agent-run-detail"] footer');
await measure(
  page,
  "runFooterOpen",
  '[data-testid="agent-run-footer-open-board"]',
);
await measure(
  page,
  "runFooterCopy",
  '[data-testid="agent-run-footer-copy-link"]',
);
await measure(page, "runHeader", '[data-testid="agent-run-detail"] > header');

// Board control at 1440.
await page.goto(`${base}/board/px-board-agent-ops?agents=inbox`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1600);
await measure(page, "acModal", '[data-testid="agent-control-dialog"]');
await measure(page, "acHead", '[data-testid="agent-control-dialog"] header');
await measure(page, "acRail", '[data-testid="agent-control-dialog"] nav');
await measure(page, "acToolbar", '[data-testid="approval-detail"]');
await measure(
  page,
  "boardApprovalFooter",
  '[data-testid="approval-detail"] footer',
);
await measure(page, "boardApprovalReject", '[data-testid="approval-reject"]');
await measure(page, "boardApprovalApprove", '[data-testid="approval-approve"]');
await measure(
  page,
  "boardApprovalCancel",
  '[data-testid="approval-cancel-menu"]',
);

await page.goto(`${base}/board/px-board-agent-ops?agents=live`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1600);
await measure(page, "liveCard", '[data-testid="live-status-card"]');
await measure(page, "livePauseAll", '[data-testid="live-status-pause"]');
await measure(page, "liveRowPause", '[data-testid="agent-session-pause"]');
await measure(page, "liveRowEnd", '[data-testid="agent-session-end"]');
await measure(page, "acFoot", '[data-testid="agent-live-panel"] footer');

await page.getByTestId("agent-session-pause").first().click();
await page.waitForTimeout(300);
await measure(page, "pauseDialog", '[data-testid="agent-action-dialog"]');
await measure(page, "pauseTitle", '[data-testid="agent-action-dialog"] h2');
await measure(
  page,
  "pauseReason",
  '[data-testid="agent-action-dialog"] textarea',
);
await measure(page, "pauseCancel", '[data-testid="agent-action-cancel"]');
await measure(page, "pauseConfirm", '[data-testid="agent-action-confirm"]');
await page.keyboard.press("Escape");
await page.getByTestId("agent-session-end").first().click();
await page.waitForTimeout(300);
await measure(page, "endDialog", '[data-testid="agent-action-dialog"]');
await measure(page, "endTarget", '[data-testid="agent-end-target"]');
await page.keyboard.press("Escape");

await page.goto(`${base}/board/px-board-agent-ops?agents=runs`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1600);
await measure(page, "boardRunRow", '[data-testid^="agent-run-row-"]');
await measure(
  page,
  "boardRunsHeader",
  '[data-testid="agent-runs-panel"] .ac-toolbar',
);
await measure(page, "boardRunsTotal", '[data-testid="agent-runs-total"]');

// Tablet and mobile geometry.
for (const [width, height] of [
  [1024, 900],
  [390, 844],
]) {
  const created = await pageAt(width, height);
  await created.page.goto(`${base}/board/px-board-agent-ops?agents=live`, {
    waitUntil: "domcontentloaded",
  });
  await created.page.waitForTimeout(1600);
  await measure(
    created.page,
    `acModal-${width}`,
    '[data-testid="agent-control-dialog"]',
  );
  await measure(
    created.page,
    `acHead-${width}`,
    '[data-testid="agent-control-dialog"] header',
  );
  await measure(
    created.page,
    `acFoot-${width}`,
    '[data-testid="agent-live-panel"] footer',
  );
  const overflow = await created.page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  result[`overflow-${width}`] = overflow;
  await created.context.close();
}

await writeFile(out, JSON.stringify(result, null, 2));
await context.close();
await browser.close();
console.log(`wrote ${out}`);
