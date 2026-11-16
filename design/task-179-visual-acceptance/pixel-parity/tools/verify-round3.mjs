/** Read-only round-3 smoke checks against the disposable pixel stack. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const api = "http://127.0.0.1:5302/api/v1";
const base = "http://127.0.0.1:5301";
const board = "px-board-agent-ops";
const browser = await chromium.launch({ headless: true });
const output = [];

async function login(role) {
  let response;
  for (let n = 0; n < 3; n++) {
    response = await fetch(`${api}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `pixel-${role}@example.com`,
        password: "pixel-demo-password",
      }),
    });
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }
  assert.equal(response.status, 200, `${role} login`);
  const { accessToken } = await response.json();
  const raw = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("refresh_token="));
  assert.ok(raw);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
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
  return { context, accessToken };
}

const admin = await login("admin");
for (const [id, expected] of [
  ["run-128", true],
  ["run-126", true],
  ["run-121", false],
]) {
  const response = await fetch(
    `${api}/boards/${board}/runs/${id}/revert/preview`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  const body = await response.json();
  assert.equal(
    response.ok && body.canRevert === true,
    expected,
    `${id} preview: ${JSON.stringify(body)}`,
  );
  if (!expected)
    assert.ok(
      response.status === 409 || (response.ok && body.canRevert === false),
      `unexpected conflict response: ${response.status}`,
    );
  output.push(
    `${id}: HTTP ${response.status}, canRevert=${body.canRevert ?? false}`,
  );
}
const page = await admin.context.newPage();
for (const theme of ["dark", "light"]) {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${base}/agents?section=attention&lng=en`);
    await page.getByTestId("agents-page").waitFor();
    await page.evaluate(
      (value) => localStorage.setItem("janosik-theme", value),
      theme,
    );
    await page.reload();
    await page.getByTestId("agents-page").waitFor();
    assert.equal(
      await page
        .locator("html")
        .evaluate((element, value) => element.classList.contains(value), theme),
      true,
    );
    await page.goto(`${base}/board/${board}?agents=inbox`);
    await page.getByTestId("agent-control-dialog").waitFor();
    const row = page.getByTestId("approval-row-px-approval-landing");
    await row.waitFor();
    await row.click();
    await page.getByTestId("approval-reject").waitFor();
    const footer = page.locator(".ac-foot-approval");
    if (width === 390) {
      const reject = await page.getByTestId("approval-reject").boundingBox();
      const approve = await page.getByTestId("approval-approve").boundingBox();
      assert.ok(
        reject.height >= 44 &&
          approve.height >= 44 &&
          reject.width >= 150 &&
          approve.width >= 150,
        `mobile approval buttons ${JSON.stringify({ reject, approve })}`,
      );
    }
    await page.getByTestId("approval-approve").click();
    const dialog = page.getByTestId("approval-approve-dialog");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /command.*Target:/s);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByTestId("approval-reject").click();
    const form = await footer.locator("form").boundingBox();
    const text = await page.getByTestId("approval-comment").boundingBox();
    assert.ok(
      form.width > (width === 390 ? 300 : 400) &&
        Math.abs(form.width - text.width) < 2,
      `reject form ${JSON.stringify({ form, text })}`,
    );
    await page.screenshot({
      path: `design/task-179-visual-acceptance/pixel-parity/screenshots/round3-board-reject-admin-${theme}-${width}.png`,
    });
    output.push(
      `${theme} ${width}: reject form ${Math.round(form.width)}px, textarea ${Math.round(text.width)}px`,
    );
    if (width === 390) {
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
      await page.getByTestId("agent-pause-tab").click();
      const pause = await page
        .getByTestId("agent-session-pause")
        .first()
        .boundingBox();
      const end = await page
        .getByTestId("agent-session-end")
        .first()
        .boundingBox();
      assert.ok(
        pause.width >= 75 &&
          pause.height >= 44 &&
          end.height >= 44 &&
          end.y > pause.y,
        `mobile Live actions: ${JSON.stringify({ pause, end })}`,
      );
    }
  }
}
await page.goto(
  `${base}/agents?section=attention&board=${board}&approval=px-approval-expired`,
);
await page.getByTestId("approval-links").waitFor();
assert.equal(await page.getByTestId("approval-session-link").count(), 0);
assert.match(
  await page.getByTestId("agents-approval-detail").innerText(),
  /Release bot/,
);
await page.goto(
  `${base}/agents?section=sessions&q=missing-pixel-session&lng=ru`,
);
await page.getByTestId("agents-filtered-empty").waitFor();
assert.equal(await page.getByTestId("agents-detail-create-key").count(), 0);
await admin.context.close();
const member = await login("member");
const memberPage = await member.context.newPage();
await memberPage.goto(`${base}/board/${board}?agents=live`);
await memberPage.getByTestId("agent-control-dialog").waitFor();
assert.equal(await memberPage.getByTestId("agent-session-pause").count(), 0);
assert.equal(await memberPage.getByTestId("agent-session-end").count(), 0);
output.push(
  "member Live: no pause/end actions; expired approval: no session link; RU filtered-empty: no create-key detail",
);
await member.context.close();
await browser.close();
console.log(output.join("\n"));
