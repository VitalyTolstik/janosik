import { test, expect } from "@/fixtures/auth.js";
import { appUrl } from "@/helpers/urls.js";
import type { Locator } from "@playwright/test";

async function expectReachableByScrolling(target: Locator) {
  await expect(target).toBeVisible();
  const page = target.page();
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollHeight),
  ).toBeGreaterThan(320);
  await page.mouse.move(284, 160);
  await page.mouse.wheel(0, 700);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect(target).toBeInViewport();
}

test.use({ viewport: { width: 568, height: 320 } });

test("registration, OAuth and recovery controls are reachable on short screens", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { allowRegistration: true } }),
  );
  await page.route("**/api/v1/auth/oauth/providers", (route) =>
    route.fulfill({ json: { providers: [{ id: "google", label: "Google" }] } }),
  );
  const deepLink = new URL("board/b-1?card=c-1&mode=register#details", appUrl);
  await page.goto(deepLink.href);
  await expectReachableByScrolling(page.getByTestId("login-toggle"));

  const oauth = new URL(
    (await page.getByTestId("login-oauth-google").getAttribute("href"))!,
    appUrl,
  );
  expect(oauth.searchParams.get("returnTo")).toBe(
    deepLink.pathname + deepLink.search + deepLink.hash,
  );

  await page.getByTestId("login-toggle").click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectReachableByScrolling(
    page.getByRole("button", { name: "Send recovery code" }),
  );

  deepLink.searchParams.set("authError", "oauth_failed");
  await page.goto(deepLink.href);
  await expect(page.getByTestId("login-error")).toContainText(
    "External sign-in failed",
  );
  deepLink.searchParams.delete("authError");
  await expect(page).toHaveURL(deepLink.href);
});

test("successful registration consumes the mode before the verification gate and sign-out", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { allowRegistration: true } }),
  );
  // Reuse a real session cookie while supplying an unverified registration DTO.
  await page.route("**/api/v1/auth/register", async (route) => {
    const response = await route.fetch({
      url: new URL("/api/v1/auth/login", appUrl).href,
      postData: user,
    });
    const session = await response.json();
    await route.fulfill({
      response,
      json: {
        ...session,
        user: { ...session.user, emailVerifiedAt: null, locale: "en" },
      },
    });
  });
  await page.goto(new URL("?mode=register&keep=1#details", appUrl).href);
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(new URL("?keep=1#details", appUrl).href);
  const signOut = page.getByTestId("email-verify-signout");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectReachableByScrolling(signOut);
  await signOut.click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("login-display-name")).toHaveCount(0);
});
