import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
await page.goto("http://127.0.0.1:5301/login", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(600);
await page.getByTestId("login-email").fill("pixel-admin@example.com");
await page.getByTestId("login-password").fill("pixel-demo-password");
await page.getByTestId("login-submit").click();
await page.waitForTimeout(1200);
await page.goto("http://127.0.0.1:5301/board/px-board-agent-ops?agents=live", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const footer = document.querySelector(".ac-foot");
  if (!footer) return null;
  const style = getComputedStyle(footer);
  const box = footer.getBoundingClientRect();
  const parent = footer.parentElement;
  const pbox = parent.getBoundingClientRect();
  return {
    footer: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      position: style.position,
      left: style.left,
      right: style.right,
    },
    parent: {
      tag: parent.tagName,
      cls: parent.className,
      x: pbox.x,
      y: pbox.y,
      width: pbox.width,
      height: pbox.height,
      position: getComputedStyle(parent).position,
    },
    offsetParent: footer.offsetParent
      ? { tag: footer.offsetParent.tagName, cls: footer.offsetParent.className }
      : null,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
