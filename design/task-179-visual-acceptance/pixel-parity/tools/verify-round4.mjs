/** Read-only browser checks on the disposable round-4 seed. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const api = "http://127.0.0.1:5302/api/v1";
const base = "http://127.0.0.1:5301";
const seed = JSON.parse(await readFile("/tmp/pixel-seed.json", "utf8"));
const board = seed.boards.agentOps;
const browser = await chromium.launch({ headless: true });
const results = [];
const out = "design/task-179-visual-acceptance/pixel-parity/screenshots";
await mkdir(out, { recursive: true });

async function contextFor(role) {
  const response = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `pixel-${role}@example.com`,
      password: "pixel-demo-password",
    }),
  });
  assert.equal(response.status, 200, `login ${role}`);
  const cookie = response.headers
    .getSetCookie()
    .find((v) => v.startsWith("refresh_token="));
  assert.ok(cookie);
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "refresh_token",
      value: cookie.slice(14).split(";")[0],
      domain: "127.0.0.1",
      path: "/api/v1/auth",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  return context;
}

try {
  for (const role of ["admin", "member"]) {
    const context = await contextFor(role);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    for (const width of [1440, 1024, 390])
      for (const theme of ["light", "dark"])
        for (const lang of ["en", "ru"]) {
          const tag = `${role}-${theme}-${width}-${lang}`;
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          await page.emulateMedia({ colorScheme: theme });
          await page.goto(
            `${base}/agents?section=runs&board=${board}&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agents-page").waitFor();
          await page.evaluate(
            (v) => localStorage.setItem("janosik-theme", v),
            theme,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByTestId("agents-page").waitFor();
          await page.waitForFunction(
            (v) => document.documentElement.lang.startsWith(v),
            lang,
          );
          await page.waitForFunction(
            (v) => document.documentElement.classList.contains(v),
            theme,
          );
          await page.waitForFunction(() =>
            /\d/.test(
              document.querySelector('[data-testid="agents-section-runs"]')
                ?.textContent ?? "",
            ),
          );
          const count = (
            await page.getByTestId("agents-section-runs").innerText()
          ).match(/\d+/)?.[0];
          assert.ok(count, `${tag} run count`);
          await page.goto(
            `${base}/agents?section=runs&board=${board}&status=failed&session=px-session-idle&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.waitForFunction(
            (v) =>
              (
                document.querySelector('[data-testid="agents-section-runs"]')
                  ?.textContent ?? ""
              ).includes(v),
            count,
          );
          await page.goto(
            `${base}/agents?section=runs&board=${board}&run=${seed.runs.failed}&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agent-run-failed-banner").waitFor();
          assert.equal(
            await page.getByTestId("agent-run-preimages").count(),
            0,
          );
          assert.equal(await page.getByTestId("agent-run-preimage").count(), 0);
          assert.equal(
            (await page
              .getByText(lang === "ru" ? "Не применено" : "Not applied")
              .count()) > 0,
            true,
          );
          const openBox = await page
            .getByTestId("agent-run-footer-open-board")
            .boundingBox();
          const copyBox = await page
            .getByTestId("agent-run-footer-copy-link")
            .boundingBox();
          assert.ok(
            openBox && copyBox && Math.abs(openBox.width - copyBox.width) < 0.2,
            `${tag} footer widths`,
          );
          await page.screenshot({ path: `${out}/round4-failed-${tag}.png` });
          await page.goto(
            `${base}/agents?section=runs&board=${board}&run=${seed.runs.plusTwo}&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agent-run-rollback-card").waitFor();
          const rollback = page.getByTestId("agent-run-rollback-card");
          const background = await rollback.evaluate(
            (el) => getComputedStyle(el).backgroundColor,
          );
          assert.equal(background, "rgba(0, 0, 0, 0)");
          if (width !== 390)
            assert.equal(
              Math.round(
                (await page.getByTestId("agent-run-preview").boundingBox())
                  .height,
              ),
              28,
            );
          await page.screenshot({ path: `${out}/round4-rollback-${tag}.png` });
          await page.goto(
            `${base}/agents?approval=px-approval-landing&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agents-missing-scope").waitFor();
          assert.equal(
            await page.getByTestId("agents-approval-detail").count(),
            0,
          );
          await page.goto(
            `${base}/agents?board=unknown-pixel-board&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agents-unknown-board").waitFor();
          assert.equal(
            await page.getByTestId("agents-updated").isVisible(),
            false,
          );
          await page.goto(`${base}/board/${board}?agents=live&lng=${lang}`, {
            waitUntil: "domcontentloaded",
          });
          await page.getByTestId("agent-live-panel").waitFor();
          await page
            .getByTestId("agent-session-row-px-session-stale")
            .waitFor();
          const stale = page.getByTestId("agent-session-row-px-session-stale");
          assert.equal(
            await stale.getByTestId("agent-status-active").count(),
            1,
          );
          assert.equal(
            await stale.getByTestId("agent-session-no-heartbeat").count(),
            1,
          );
          assert.equal(
            await stale.getByTestId("agent-status-stale").count(),
            0,
          );
          assert.equal(
            await page.getByTestId("agent-live-manage-tokens").count(),
            1,
          );
          if (lang === "ru")
            assert.match(
              await page.getByTestId("agent-live-panel").textContent(),
              /2 токена/,
            );
          await page.screenshot({ path: `${out}/round4-live-${tag}.png` });
          if (role === "admin") {
            await page.goto(`${base}/board/${board}?agents=inbox&lng=${lang}`, {
              waitUntil: "domcontentloaded",
            });
            await page.getByTestId("approval-row-px-approval-landing").click();
            await page.getByTestId("approval-reject").click();
            const reason = page.getByTestId("approval-comment");
            await reason.waitFor();
            assert.match(
              await reason.getAttribute("placeholder"),
              lang === "ru" ? /миграции/ : /migration/,
            );
            const labelWeight = await page
              .locator('label[for="approval-comment"] span')
              .evaluate((el) => getComputedStyle(el).fontWeight);
            assert.equal(labelWeight, "600");
            await page.screenshot({ path: `${out}/round4-reject-${tag}.png` });
            await page.goto(`${base}/board/${board}?agents=inbox&lng=${lang}`, {
              waitUntil: "domcontentloaded",
            });
            await page.getByTestId("approval-row-px-approval-landing").click();
            await page.getByTestId("approval-approve").click();
            const dialog = page.getByTestId("approval-approve-dialog");
            await dialog.waitFor();
            assert.equal((await dialog.innerText()).includes(".."), false);
            await page.screenshot({ path: `${out}/round4-approve-${tag}.png` });
          }
          assert.deepEqual(pageErrors, [], `${tag} page errors`);
          results.push({
            role,
            width,
            theme,
            lang,
            boardRunCount: Number(count),
            checks: [
              "unfiltered badge",
              "failed run",
              "equal footer widths",
              "rollback styling",
              "missing board",
              "unknown board",
              "stale lifecycle",
              ...(role === "admin"
                ? ["approval confirmation", "reject form"]
                : []),
            ],
          });
          console.log(`PASS ${tag}`);
        }
    await context.close();
  }
  await writeFile(
    "design/task-179-visual-acceptance/pixel-parity/round4-browser-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
