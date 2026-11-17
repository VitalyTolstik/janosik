import { chromium } from "playwright";

const base = "http://127.0.0.1:5301";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
const page = await context.newPage();
await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.getByTestId("login-email").fill("pixel-admin@example.com");
await page.getByTestId("login-password").fill("pixel-demo-password");
await page.getByTestId("login-submit").click();
await page.waitForTimeout(1200);
await page.goto(`${base}/board/px-board-agent-ops?agents=live`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1500);
console.log("dialog", await page.getByTestId("agent-control-dialog").count());
console.log(
  "live tab selected",
  await page.getByTestId("agent-pause-tab").getAttribute("aria-selected"),
);
console.log("url", page.url());
await browser.close();
