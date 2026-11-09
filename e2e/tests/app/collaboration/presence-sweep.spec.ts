import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence, presenceStack } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 120_000 });

test("the sweep drops a session whose heartbeat is blocked after the TTL", async ({
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
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(page, 2);

  // The stream stays open (so no explicit `leave`): only the missing
  // heartbeats can age this session out of the roster.
  let blocked = 0;
  await partnerBrowser.page.route(/\/presence$/, (route) => {
    blocked += 1;
    return route.abort();
  });

  await expect(presenceStack(page)).toBeHidden({ timeout: 85_000 });
  expect(blocked).toBeGreaterThan(0);
});
