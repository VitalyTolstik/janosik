import { test, expect, adminContext } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import {
  adminPath,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";
import { waitForMessage } from "@/helpers/mail.js";

/** Communications core (TASK-162.15 full): announcements and templates. */

test("S14: creating an announcement for a segment from the panel", async ({
  page,
  admin,
  targetUser,
}) => {
  const title = uniqueToken("announcement-segment");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-announcement-new").click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("admin-announcement-title").fill(title);
  await page.getByTestId("admin-announcement-body").fill(`Body ${title}`);
  await page.getByTestId("announcement-tab-ru").click();
  await page.getByTestId("admin-announcement-title-ru").fill(`RU ${title}`);
  await page.getByTestId("admin-announcement-body-ru").fill(`Тело ${title}`);
  await page.getByTestId("admin-announcement-level").click();
  await page.getByTestId("admin-announcement-level-option-warning").click();
  await page.getByTestId("admin-announcement-audience").click();
  await page.getByTestId("admin-announcement-audience-option-segment").click();
  await page
    .getByTestId("admin-announcement-recipients")
    .fill(targetUser.email);
  await dialog
    .getByRole("button", { name: new RegExp(targetUser.email) })
    .click();
  await page.getByTestId("admin-announcement-publish").click();

  await page.goto(adminPath("announcements"), {
    waitUntil: "domcontentloaded",
  });
  await searchAdminList(page, "announcements", title);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
  await expectAudit(admin, {
    action: "announcement.created",
    detailsText: title,
  });
});

test("S15: a segment announcement shows a banner, emails and dismisses", async ({
  browser,
  page,
  admin,
  targetUser,
  testIp,
}) => {
  const title = uniqueToken("announcement-banner");
  const body = `Banner body ${title}`;
  const created = await admin.post("/api/v1/admin/announcements", {
    data: {
      title,
      body,
      level: "warning",
      audience: "segment",
      segment: targetUser.email,
      sendEmail: true,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const announcement = (await created.json()) as { id: string };

  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, targetUser);
    const banner = userSide.page.getByTestId("announcement-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(title);
    await expect(banner).toContainText(body);

    const message = await waitForMessage(admin, {
      to: targetUser.email,
      subjectIncludes: title,
    });
    expect(message.text).toContain(body);

    await userSide.page
      .getByTestId(`announcement-dismiss-${announcement.id}`)
      .click();
    await expect(banner).toHaveCount(0);
    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(userSide.page.getByTestId("announcement-banner")).toHaveCount(
      0,
    );
    const dismissed = await userSide.page.evaluate(() =>
      localStorage.getItem("janosik.announcements.dismissed"),
    );
    expect(dismissed).toContain(announcement.id);
  } finally {
    await userSide.context.close();
  }
  await page.goto(adminPath(), { waitUntil: "domcontentloaded" });
});

test("S16: announcement history edits, toggles and deletes", async ({
  page,
  admin,
}) => {
  const title = uniqueToken("announcement-history");
  const nextTitle = uniqueToken("announcement-edited");
  const created = await admin.post("/api/v1/admin/announcements", {
    data: {
      title,
      body: `Body ${title}`,
      level: "info",
      audience: "segment",
      segment: "nobody@e2e.example",
      sendEmail: false,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("announcements"), {
    waitUntil: "domcontentloaded",
  });
  await searchAdminList(page, "announcements", title);
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("admin-announcement-legacy-title").fill(nextTitle);
  await dialog.getByTestId("admin-announcement-level").click();
  await page.getByTestId("admin-announcement-level-option-warning").click();
  await dialog.getByTestId("admin-announcement-edit-save").click();
  await expectToastText(page, "Saved");

  await page.reload({ waitUntil: "domcontentloaded" });
  await searchAdminList(page, "announcements", nextTitle);
  const edited = page.getByRole("row").filter({ hasText: nextTitle });
  await expect(edited).toContainText("Warning");
  await expect(edited).toContainText("on");

  await edited.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Deactivate", exact: true }).click();
  await expectToastText(page, "Deactivate");
  await expect(edited).toContainText("off");

  await edited.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Activate", exact: true }).click();
  await expectToastText(page, "Activate");
  await expect(edited).toContainText("on");

  await edited.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByTestId("admin-confirm-accept").click();
  await expect(
    page.getByRole("row").filter({ hasText: nextTitle }),
  ).toHaveCount(0);

  await expectAudit(admin, { action: "announcement.updated" });
  await expectAudit(admin, { action: "announcement.deleted" });
});

test("ADM-X10: all five templates preview with sample values", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });

  for (const key of [
    "verification_code",
    "email_change_code",
    "email_changed_notice",
    "digest",
    "due_reminder",
  ]) {
    await expect(page.getByTestId(`admin-template-save-${key}`)).toBeVisible();
    await expect(
      page.getByTestId(`admin-template-preview-${key}`),
    ).toBeVisible();
  }

  await page.getByTestId("admin-template-preview-verification_code").click();
  const dialog = page.getByRole("dialog");
  await expect(page.getByTestId("admin-template-preview-frame")).toBeVisible();
  await expect(dialog).toContainText("482913");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
});

async function expectToastText(
  page: import("@playwright/test").Page,
  text: string,
) {
  await expect(
    page.getByRole("status").filter({ hasText: text }).last(),
  ).toBeVisible();
}
