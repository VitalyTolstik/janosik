import { test, expect } from "@/fixtures/admin.js";
import { appUrl } from "@/helpers/urls.js";
import {
  adminPath,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
  uniqueToken,
} from "@/helpers/admin.js";

/** Global OAuth providers (TASK-162.15 full): both runtime login buttons. */

test("S4/ADM-X4: enabling Google and Yandex updates the user login screen", async ({
  browser,
  page,
  admin,
}) => {
  const loginPage = await browser.newContext({ locale: "en-US" });
  try {
    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("oauth"), { waitUntil: "domcontentloaded" });

    for (const provider of ["google", "yandex"]) {
      await page
        .getByTestId(`admin-oauth-client-id-${provider}`)
        .fill(`e2e-${provider}-${uniqueToken("client")}`);
      await page
        .getByTestId(`admin-oauth-secret-${provider}`)
        .fill(`e2e-${provider}-secret`);
      const enabled = page.getByTestId(`admin-oauth-enabled-${provider}`);
      if (!(await enabled.isChecked())) await enabled.click();
      await page.getByTestId(`admin-oauth-save-${provider}`).click();
      await expect(
        page.getByTestId(`admin-oauth-status-${provider}`),
      ).toHaveText("Enabled");
      await expect(
        page.getByTestId(`admin-oauth-callback-${provider}`),
      ).toContainText(`/api/v1/auth/oauth/${provider}/callback`);
    }

    const userPage = await loginPage.newPage();
    await userPage.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("login-oauth-google")).toBeVisible();
    await expect(userPage.getByTestId("login-oauth-yandex")).toBeVisible();

    const googleEnabled = page.getByTestId("admin-oauth-enabled-google");
    if (await googleEnabled.isChecked()) await googleEnabled.click();
    await page.getByTestId("admin-oauth-save-google").click();
    await expect(page.getByTestId("admin-oauth-status-google")).toHaveText(
      "Disabled",
    );
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("login-oauth-google")).toHaveCount(0);
    await expect(userPage.getByTestId("login-oauth-yandex")).toBeVisible();

    const yandexEnabled = page.getByTestId("admin-oauth-enabled-yandex");
    if (await yandexEnabled.isChecked()) await yandexEnabled.click();
    await page.getByTestId("admin-oauth-save-yandex").click();
  } finally {
    await loginPage.close();
  }

  await expectAudit(admin, { action: "oauth.settings_changed" });
});
