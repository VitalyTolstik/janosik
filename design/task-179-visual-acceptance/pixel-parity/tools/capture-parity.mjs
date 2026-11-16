/**
 * Capture the TASK-179 pixel-parity evidence matrix from the disposable stack.
 *
 * Prereqs:
 *   - scripts/seed-agent-pixel-demo.mjs has just run and wrote /tmp/pixel-seed.json
 *   - API :5302, Vite UI :5301
 *
 * Output: design/task-179-visual-acceptance/pixel-parity/screenshots/
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "screenshots");
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:5301";
const seed = JSON.parse(await readFile("/tmp/pixel-seed.json", "utf8"));
const runIds = seed.runs;
const approvals = {
  pending: "px-approval-landing",
  rejected: "px-approval-rejected",
  expired: "px-approval-expired",
  cancelled: "px-approval-cancelled",
  consumed: "px-approval-consumed",
  website: "px-approval-website",
};

const browser = await chromium.launch({ headless: true });
const measurements = {};

async function newPage({ width, height, theme, locale = "en-US" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    locale,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.getByTestId("login-email").count()) > 0) {
      await page
        .getByTestId("login-email")
        .fill(
          role === "admin"
            ? "pixel-admin@example.com"
            : "pixel-member@example.com",
        );
      await page.getByTestId("login-password").fill("pixel-demo-password");
      await page.getByTestId("login-submit").click();
      await page.waitForTimeout(1200);
    }
    // The login route itself is not an app route: after auth the shell may
    // briefly render its 404. A full navigation restores the session through
    // the refresh cookie and lands on a real route.
    await page.goto(`${base}/agents`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    if ((await page.getByTestId("login-email").count()) === 0) {
      return { context, page, errors };
    }
  }
  throw new Error(`login failed for ${role} at ${width}x${height}`);
}

let role = "admin";

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

async function go(page, url) {
  await page.goto(`${base}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

async function measure(page, key, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return;
  const value = await locator.evaluate((element) => {
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
  measurements[key] = value;
}

async function currentRolePage(options) {
  const created = await newPage(options);
  return created;
}

async function captureCombo(width, height, theme, roleName, locale = "en-US") {
  role = roleName;
  const { context, page, errors } = await currentRolePage({
    width,
    height,
    theme,
    locale,
  });
  const prefix = `${roleName}-${theme}-${width}`;
  const suffix = `-${roleName}-${theme}-${width}`;

  // /agents Attention.
  await go(page, "/agents?section=attention");
  await page.waitForTimeout(1500);
  await shot(page, `agents-attention${suffix}`);
  if (role === "admin") {
    const review = page.getByTestId(
      "agents-approval-review-px-approval-landing",
    );
    if ((await review.count()) > 0) {
      await review.click();
      await page.waitForTimeout(500);
      await shot(page, `agents-approval-detail${suffix}`);
      await page
        .locator('[data-testid="agents-approval-detail"] .overflow-y-auto')
        .last()
        .evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      await shot(page, `agents-approval-related${suffix}`);
      if (await page.getByTestId("approval-reject").count()) {
        await page.getByTestId("approval-reject").click();
        await shot(page, `agents-approval-reject${suffix}`);
        await page.getByRole("button", { name: "Cancel" }).last().click();
      }
    }
  }

  // Sessions + detail + modals.
  await go(page, "/agents?section=sessions");
  await shot(page, `agents-sessions${suffix}`);
  const sessionRows = page.locator('[data-testid^="agent-session-row-"]');
  if (await sessionRows.count()) {
    await sessionRows.first().click();
    await page.waitForTimeout(500);
    await shot(page, `agents-session-detail${suffix}`);
    const pause = page.getByTestId("agents-session-pause");
    if (await pause.count()) {
      await pause.click();
      await page.waitForTimeout(300);
      await shot(page, `agents-session-pause${suffix}`);
      if (width === 1440 && role === "admin" && theme === "dark") {
        await measure(
          page,
          "pauseModal",
          '[data-testid="agent-action-dialog"]',
        );
        await measure(
          page,
          "pauseTitle",
          '[data-testid="agent-action-dialog"] h2',
        );
        await measure(
          page,
          "pauseReason",
          '[data-testid="agent-action-dialog"] textarea',
        );
        await measure(
          page,
          "pauseConfirm",
          '[data-testid="agent-action-confirm"]',
        );
      }
      await page.keyboard.press("Escape");
    }
    const end = page.getByTestId("agents-session-end");
    if (await end.count()) {
      await end.click();
      await page.waitForTimeout(300);
      await shot(page, `agents-session-end${suffix}`);
      if (width === 1440 && role === "admin" && theme === "dark") {
        await measure(page, "endModal", '[data-testid="agent-action-dialog"]');
        await measure(page, "endTarget", '[data-testid="agent-end-target"]');
      }
      await page.keyboard.press("Escape");
    }
  }

  // Runs + detail.
  await go(page, "/agents?section=runs");
  await shot(page, `agents-runs${suffix}`);
  if (await page.locator('[data-testid="agent-run-detail"]').count()) {
    if (width === 1440 && role === "admin" && theme === "dark") {
      await measure(
        page,
        "runFooter",
        '[data-testid="agent-run-detail"] footer',
      );
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
    }
    await page
      .locator('[data-testid="agent-run-detail"] .overflow-y-auto')
      .last()
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await shot(page, `agents-run-rollback${suffix}`);
  }

  // Board-scoped Agent control: the landing tab depends on role.
  await go(
    page,
    `/board/px-board-agent-ops?agents=${role === "admin" ? "inbox" : "live"}`,
  );
  await page.waitForTimeout(800);
  if ((await page.getByTestId("agent-control-dialog").count()) === 0) {
    const trigger = page.getByTestId(
      role === "admin" ? "agent-control-trigger" : "agent-runs-trigger",
    );
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(700);
    }
  }
  await shot(page, `control-landing${suffix}`);
  if (role === "admin") {
    const approvalRows = page.locator('[data-testid^="approval-row-"]');
    if (await approvalRows.count()) {
      await approvalRows.first().click();
      await page.waitForTimeout(500);
      await shot(page, `control-approval-detail${suffix}`);
      if (width === 1440 && theme === "dark") {
        await measure(
          page,
          "boardApprovalFooter",
          '[data-testid="approval-detail"] footer',
        );
        await measure(
          page,
          "boardApprovalReject",
          '[data-testid="approval-reject"]',
        );
        await measure(
          page,
          "boardApprovalApprove",
          '[data-testid="approval-approve"]',
        );
        await measure(
          page,
          "boardApprovalCancel",
          '[data-testid="approval-cancel-menu"]',
        );
      }
    }
  }
  await page.getByTestId("agent-pause-tab").click();
  await page.waitForTimeout(500);
  await shot(page, `control-live${suffix}`);
  if (width === 1440 && theme === "dark") {
    await measure(page, "liveCard", '[data-testid="live-status-card"]');
    await measure(page, "livePauseAll", '[data-testid="live-status-pause"]');
  }
  const liveEnd = page.getByTestId("agent-session-end");
  if (await liveEnd.count()) {
    await liveEnd.first().click();
    await page.waitForTimeout(300);
    await shot(page, `control-session-end${suffix}`);
    await page.keyboard.press("Escape");
  }
  const livePause = page.getByTestId("agent-session-pause");
  if (await livePause.count()) {
    await livePause.first().click();
    await page.waitForTimeout(300);
    await shot(page, `control-session-pause${suffix}`);
    await page.keyboard.press("Escape");
  }

  await page.getByTestId("agent-runs-tab").click();
  await page.waitForTimeout(700);
  await shot(page, `control-runs${suffix}`);
  if (width === 1440 && theme === "dark") {
    await measure(
      page,
      "boardRunsHeader",
      '[data-testid="agent-runs-panel"] .ac-toolbar',
    );
    await measure(page, "boardRunsTotal", '[data-testid="agent-runs-total"]');
    await measure(page, "boardRunRow", '[data-testid^="agent-run-row-"]');
  }
  if (await page.locator('[data-testid="agent-run-detail"]').count()) {
    await page
      .locator('[data-testid="agent-run-detail"] .overflow-y-auto')
      .last()
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await shot(page, `control-run-rollback${suffix}`);
  }

  if (errors.length > 0) {
    await writeFile(
      path.join(out, `errors-${prefix}.json`),
      JSON.stringify(errors, null, 2),
    );
  }
  await context.close();
}

async function captureExtraStates() {
  role = "admin";
  const { context, page } = await newPage({
    width: 1440,
    height: 900,
    theme: "dark",
  });
  const suffix = "-admin-dark-1440";

  const details = [
    ["conflict", runIds.conflict, "px-board-agent-ops"],
    ["expired", runIds.expired, "px-board-website"],
    ["failed", runIds.failed, "px-board-agent-ops"],
    ["reverted", runIds.reverted, "px-board-agent-ops"],
  ];
  for (const [name, runId, boardId] of details) {
    await go(page, `/agents?section=runs&board=${boardId}&run=${runId}`);
    await page.waitForTimeout(900);
    await shot(page, `state-run-${name}${suffix}`);
    await page
      .locator('[data-testid="agent-run-detail"] .overflow-y-auto')
      .last()
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await shot(page, `state-run-${name}-rollback${suffix}`);
  }

  const approvalStates = ["rejected", "expired", "cancelled", "consumed"];
  for (const state of approvalStates) {
    await go(
      page,
      `/agents?section=attention&board=px-board-agent-ops&approval=${approvals[state]}`,
    );
    await page.waitForTimeout(600);
    await shot(page, `state-approval-${state}${suffix}`);
  }

  // Paused board state: pause through the API, capture Live, then resume.
  const token = await page.evaluate(() => null);
  void token;
  await go(page, "/board/px-board-agent-ops?agents=live");
  await page.getByTestId("board-pause").click();
  await page.getByTestId("board-pause-reason").fill("Evidence pause");
  await page.getByTestId("board-pause-confirm").click();
  await page.waitForTimeout(700);
  await shot(page, `state-board-paused${suffix}`);
  await page.getByTestId("board-resume").click();
  await page.getByTestId("board-resume-confirm").click();
  await page.waitForTimeout(500);

  await context.close();
}

async function captureLanguages() {
  for (const locale of ["ru-RU"]) {
    role = "admin";
    const { context, page } = await newPage({
      width: 1440,
      height: 900,
      theme: "dark",
      locale,
    });
    // The server profile locale wins after login, so the marketing-style
    // `?lng=` handoff is the reliable way to force the RU catalog here.
    await go(page, "/agents?section=attention&lng=ru");
    await shot(page, `agents-attention-admin-dark-1440-${locale}`);
    await go(page, "/board/px-board-agent-ops?agents=inbox&lng=ru");
    await page.waitForTimeout(700);
    await shot(page, `control-inbox-admin-dark-1440-${locale}`);
    await context.close();
  }
}

for (const width of [1440, 1024, 390]) {
  const height = width === 390 ? 844 : 900;
  for (const theme of ["dark", "light"]) {
    for (const roleName of ["admin", "member"]) {
      await captureCombo(width, height, theme, roleName);
    }
  }
}
await captureExtraStates();
await captureLanguages();

await writeFile(
  path.join(root, "measurements.json"),
  JSON.stringify(measurements, null, 2),
);
await browser.close();
console.log(`captured evidence in ${out}`);
