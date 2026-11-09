import { test, expect, randomIp } from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";

test("shows the account lockout wait and keeps rejecting the right password", async ({
  page,
  request,
  createUser,
}) => {
  const user = await createUser();

  // Five wrong attempts for the same address lock the account. Every call
  // uses a fresh forwarded IP so the per-IP throttler never answers first.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/v1/auth/login", {
      headers: { "X-Forwarded-For": randomIp() },
      data: { email: user.email, password: "definitely-wrong" },
    });
    expect(response.status()).toBe(401);
  }

  await page.goto(appUrl);
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("login-error")).toHaveText(
    /Too many failed attempts — try again in \d+ s/,
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);

  // A reload does not clear the lock, and the right password from a fresh
  // address still gets the account backoff instead of a session.
  await page.reload();
  await expect(page.getByTestId("login-submit")).toBeVisible();
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);

  const locked = await request.post("/api/v1/auth/login", {
    headers: { "X-Forwarded-For": randomIp() },
    data: user,
  });
  expect(locked.status()).toBe(429);
  const body = (await locked.json()) as {
    code?: string;
    retryAfter?: number;
  };
  expect(body.code).toBe("login_backoff");
  expect(body.retryAfter).toBeGreaterThan(0);
});
