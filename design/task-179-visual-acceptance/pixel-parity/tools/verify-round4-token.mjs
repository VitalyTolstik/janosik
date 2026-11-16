/** Token detail lifecycle, stale signal, and title across the review matrix. */
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
            `http://127.0.0.1:5301/agents/px-token-claude?lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agent-session-list").waitFor();
          await page.evaluate(
            (value) => localStorage.setItem("janosik-theme", value),
            theme,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByTestId("agent-session-list").waitFor();
          await page.waitForFunction(
            (value) => document.documentElement.lang.startsWith(value),
            lang,
          );
          await page.waitForFunction(
            (value) => document.documentElement.classList.contains(value),
            theme,
          );
          assert.match(
            await page.title(),
            lang === "ru" ? /^Агенты — Janosik$/ : /^Agents — Janosik$/,
          );
          const cards = page.getByTestId("agent-session");
          const stale = cards.filter({
            has: page.getByTestId("agent-stale-badge"),
          });
          assert.equal(await stale.count(), 1, `${tag} stale session`);
          assert.equal(
            await stale.first().getByTestId("agent-stale-badge").count(),
            1,
          );
          assert.equal(
            await stale.first().getByTestId("agent-status-active").count(),
            1,
          );
          await page.screenshot({
            path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round4-token-${tag}.png`,
          });
          results.push({
            role,
            width,
            theme,
            lang,
            checks: ["title", "lifecycle", "one stale signal"],
          });
          console.log(`PASS ${tag}`);
        }
    await context.close();
  }
  await writeFile(
    "design/task-179-visual-acceptance/pixel-parity/round4-token-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
