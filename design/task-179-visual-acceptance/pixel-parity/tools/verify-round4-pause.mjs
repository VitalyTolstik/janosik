/** Pause-dialog layout and member controls across the review matrix. */
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
            `http://127.0.0.1:5301/board/px-board-agent-ops?agents=live&lng=${lang}`,
            { waitUntil: "domcontentloaded" },
          );
          await page.getByTestId("agent-live-panel").waitFor();
          await page.evaluate(
            (v) => localStorage.setItem("janosik-theme", v),
            theme,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByTestId("agent-live-panel").waitFor();
          await page.waitForFunction(
            (v) => document.documentElement.lang.startsWith(v),
            lang,
          );
          await page.waitForFunction(
            (v) => document.documentElement.classList.contains(v),
            theme,
          );
          assert.equal(
            await page.getByTestId("agent-live-manage-tokens").count(),
            1,
          );
          if (role === "admin") {
            await page.getByTestId("live-status-pause").click();
            const dialog = page.getByTestId("board-pause-dialog");
            const field = page.getByTestId("board-pause-reason");
            await field.waitFor();
            if (width === 1440 && lang === "en") {
              const d = await dialog.boundingBox();
              const l = await dialog.locator("label span").boundingBox();
              const f = await field.boundingBox();
              assert.ok(
                d &&
                  l &&
                  f &&
                  Math.abs(l.y - d.y - 90.7) < 0.2 &&
                  Math.abs(f.y - d.y - 109.2) < 0.2,
                `${tag} reason positions`,
              );
            }
            await page.screenshot({
              path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round4-board-pause-${tag}.png`,
            });
            await page.keyboard.press("Escape");
            await page.getByTestId("agent-session-pause").first().click();
            await page.getByTestId("agent-action-reason").waitFor();
            await page.screenshot({
              path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round4-session-pause-${tag}.png`,
            });
            await page.keyboard.press("Escape");
          } else {
            assert.equal(
              await page.getByTestId("live-status-pause").count(),
              0,
            );
            assert.equal(
              await page.getByTestId("agent-session-pause").count(),
              0,
            );
          }
          results.push({
            role,
            width,
            theme,
            lang,
            checks:
              role === "admin"
                ? [
                    "board pause reason",
                    "session pause reason",
                    "manage tokens",
                  ]
                : ["read-only controls", "manage tokens"],
          });
          console.log(`PASS ${tag}`);
        }
    await context.close();
  }
  await writeFile(
    "design/task-179-visual-acceptance/pixel-parity/round4-pause-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
