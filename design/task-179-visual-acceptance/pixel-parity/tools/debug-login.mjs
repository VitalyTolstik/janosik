import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on("console", (m) => console.log("console", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("http://127.0.0.1:5301/login", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(800);
await page.getByTestId("login-email").fill("pixel-admin@example.com");
await page.getByTestId("login-password").fill("pixel-demo-password");
await page.getByTestId("login-submit").click();
await page.waitForTimeout(2500);
console.log("url", page.url());
console.log(
  "error",
  await page
    .getByTestId("login-error")
    .innerText()
    .catch(() => "none"),
);
console.log("body", (await page.locator("body").innerText()).slice(0, 200));
await page.screenshot({ path: "/tmp/login-debug.png" });
await browser.close();
