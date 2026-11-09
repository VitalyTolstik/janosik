import { createServer } from "node:http";
import { once } from "node:events";

import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("a snapshot embed renders its frozen card and an unknown theme falls back safely", async ({
  page,
  context,
  browser,
  sharing,
}) => {
  const snapshot = await sharing.createShare("snapshot");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sharing.openOwner(page);
  await page.getByTestId("share-mode-snapshot").click();
  const row = page.getByTestId("share-row").filter({ hasText: snapshot.token });
  await row.getByRole("button", { name: "Embed code" }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Copy embed code" }).click();
  const html = await page.evaluate(() => navigator.clipboard.readText());
  expect(html).toContain("theme=light");

  const anonymous = await browser.newContext();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Embedding site</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Host server did not bind a port");
  try {
    const host = await anonymous.newPage();
    await host.goto(`http://127.0.0.1:${address.port}/`);
    await host.setContent(html);
    const frame = host.frameLocator("iframe");
    await expect(
      frame.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByText("Shared · read-only")).toHaveCount(0);
    const framePage = host
      .frames()
      .find((item) => item.url().includes("embed=1"));
    expect(framePage).toBeDefined();
    await expect(framePage!.locator("html")).toHaveClass(/light/);

    // An unknown theme is not trusted: the page still renders and ends up on
    // a valid light/dark class instead of a blank or theme-less document.
    await host.setContent(
      `<iframe src="${publicUrl(
        snapshot.token,
        "?embed=1&theme=weird",
      )}" width="800" height="600"></iframe>`,
    );
    const weirdFrame = host.frameLocator("iframe");
    await expect(
      weirdFrame.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible({ timeout: 20_000 });
    const weirdPage = host
      .frames()
      .find((item) => item.url().includes("theme=weird"));
    expect(weirdPage).toBeDefined();
    await expect(weirdPage!.locator("html")).toHaveClass(/light|dark/);
  } finally {
    await anonymous.close();
    server.close();
  }
});
