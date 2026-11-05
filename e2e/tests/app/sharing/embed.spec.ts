import { test, expect } from "../../../fixtures/sharing.js";
import { createServer } from "node:http";
import { once } from "node:events";

test("embed code applies the chosen theme without overwriting the visitor preference", async ({
  page,
  context,
  browser,
  sharing,
}) => {
  await sharing.createShare("live");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sharing.openOwner(page);
  const row = page.getByTestId("share-row").first();
  const anonymous = await browser.newContext({ colorScheme: "dark" });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Embedding site</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Host server did not bind a port");
  await anonymous.addInitScript(() =>
    localStorage.setItem("janosik-theme", "light"),
  );
  try {
    const host = await anonymous.newPage();
    await host.goto(`http://127.0.0.1:${address.port}/`);
    for (const [label, expectedTheme] of [
      ["System", "system"],
      ["Light", "light"],
      ["Dark", "dark"],
    ] as const) {
      await row.getByRole("button", { name: "Embed code" }).click();
      await page.getByRole("radio", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "Copy embed code" }).click();
      const html = await page.evaluate(() => navigator.clipboard.readText());
      expect(html).toContain(`theme=${expectedTheme}`);
      await host.setContent(html);
      const frame = host.frameLocator("iframe");
      await expect(
        frame.getByTestId("card-title").filter({ hasText: "Original card" }),
      ).toBeVisible();
      await expect(frame.getByText("Live · read-only")).toHaveCount(0);
      const framePage = host
        .frames()
        .find((item) => item.url().includes("embed=1"));
      expect(framePage).toBeDefined();
      await expect(framePage!.locator("html")).toHaveClass(
        new RegExp(expectedTheme === "light" ? "light" : "dark"),
      );
      expect(
        await framePage!.evaluate(() => localStorage.getItem("janosik-theme")),
      ).toBe("light");
      if (expectedTheme === "system") {
        await host.emulateMedia({ colorScheme: "light" });
        await expect(framePage!.locator("html")).toHaveClass(/light/);
        await host.emulateMedia({ colorScheme: "dark" });
        await expect(framePage!.locator("html")).toHaveClass(/dark/);
      }
    }
  } finally {
    await anonymous.close();
    server.close();
  }
});
