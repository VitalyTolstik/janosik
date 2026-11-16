/** Remaining read-only navigation and loading checks across the review matrix. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const role of ["admin", "member"]) {
    const response = await fetch("http://127.0.0.1:5302/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `pixel-${role}@example.com`,
        password: "pixel-demo-password",
      }),
    });
    assert.equal(response.status, 200);
    const raw = response.headers
      .getSetCookie()
      .find((v) => v.startsWith("refresh_token="));
    assert.ok(raw);
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "refresh_token",
        value: raw.slice(14).split(";")[0],
        domain: "127.0.0.1",
        path: "/api/v1/auth",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
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
            `http://127.0.0.1:5301/agents?section=runs&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agents-page").waitFor();
          await page.evaluate(
            (value) => localStorage.setItem("janosik-theme", value),
            theme,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByTestId("agents-run-row-run-128").waitFor();
          await page.waitForFunction(
            (v) => document.documentElement.lang.startsWith(v),
            lang,
          );
          await page.waitForFunction(
            (v) => document.documentElement.classList.contains(v),
            theme,
          );
          await page.waitForFunction(() =>
            (
              document.querySelector('[data-testid="agents-updated"]')
                ?.textContent ?? ""
            ).includes("Website Relaunch"),
          );
          assert.match(
            await page.getByTestId("agents-updated").textContent(),
            /Agent Ops Demo/,
          );
          const before = await page
            .getByTestId("agents-count-runs")
            .innerText();
          await page.getByTestId("agents-run-row-run-128").click();
          assert.equal(new URL(page.url()).searchParams.get("scope"), "all");
          assert.equal(
            await page.getByTestId("agents-count-runs").innerText(),
            before,
          );
          await page.screenshot({
            path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round4-scope-${tag}.png`,
          });
          await page.goto(
            `http://127.0.0.1:5301/agents?section=attention&q=zzzz-no-match&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          const empty = page.getByTestId("agents-filtered-empty");
          await empty.waitFor();
          assert.match(
            await empty.innerText(),
            lang === "ru" ? /запрос/i : /approvals/i,
          );
          const board =
            role === "admin" ? "px-board-agent-ops" : "px-board-website";
          let release;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          await page.route("**/api/v1/agents/overview**", async (route) => {
            if (
              new URL(route.request().url()).searchParams.get("section") ===
              "approvals"
            )
              await gate;
            await route.continue();
          });
          await page.goto(
            `http://127.0.0.1:5301/agents?section=attention&board=${board}&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agents-approvals-loading").waitFor();
          await page.screenshot({
            path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round4-loading-${tag}.png`,
          });
          release();
          await page.unrouteAll({ behavior: "wait" });
          results.push({
            role,
            width,
            theme,
            lang,
            checks: [
              "board freshness",
              "all-board detail scope",
              "approval filtered-empty copy",
              "approval loading",
            ],
          });
          console.log(`PASS ${tag}`);
        }
    await context.close();
  }
  await writeFile(
    "design/task-179-visual-acceptance/pixel-parity/round4-navigation-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
