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
await page.waitForTimeout(1500);
await page.goto(`${base}/agents?section=runs`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);
console.log(
  "rail runs",
  await page
    .getByTestId("agents-count-runs")
    .innerText()
    .catch(() => "none"),
);
console.log(
  "top total",
  await page
    .getByTestId("agents-runs-total")
    .innerText()
    .catch(() => "none"),
);
console.log(
  "rows",
  await page.locator('[data-testid^="agents-run-row-"]').count(),
);
await browser.close();
