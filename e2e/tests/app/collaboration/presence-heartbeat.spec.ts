import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence, presenceStack } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 120_000 });

test("a live tab keeps its presence session past the 60 second TTL", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  test.slow();
  await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);

  const pings: number[] = [];
  partnerBrowser.page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/boards/${board.id}/presence`)
    ) {
      pings.push(Date.now());
    }
  });
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);
  await expectPresence(page, 2);

  // Past the server's 60 s TTL: without the 20 s heartbeat the sweep would
  // have dropped the partner and the owner would see a solo stack again.
  await page.waitForTimeout(65_000);
  await expectPresence(page, 2, 5_000);
  await expectPresence(partnerBrowser.page, 2, 5_000);

  expect(pings.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < pings.length; i++) {
    expect(pings[i] - pings[i - 1]).toBeLessThanOrEqual(25_000);
  }

  await partnerBrowser.context.close();
  await expect(presenceStack(page)).toBeHidden({ timeout: 20_000 });
});
