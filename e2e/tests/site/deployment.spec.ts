import { expect, test } from "@playwright/test";

import { appUrl, sitePage } from "@/helpers/urls.js";

test("bare directories redirect without exposing the upstream origin", async ({
  request,
}) => {
  const targets = [sitePage("/docs/"), sitePage("/screens/")];
  if (new URL(appUrl).pathname === "/app/") targets.push(appUrl);

  for (const target of targets) {
    const bare = new URL(target);
    bare.pathname = bare.pathname.replace(/\/$/, "");
    bare.search = "?lng=ru";
    const expected = new URL(target).pathname + bare.search;

    for (const method of ["GET", "HEAD"]) {
      const response = await request.fetch(bare.href, {
        method,
        maxRedirects: 0,
      });
      const context = `${method} ${bare.href}`;
      expect(response.status(), context).toBe(301);
      expect(response.headers().location, context).toBe(expected);
    }
  }
});
