import { randomUUID } from "node:crypto";
import { test, expect, adminContext, password } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
  uniqueToken,
} from "@/helpers/admin.js";
import { waitForMessage } from "@/helpers/mail.js";

/**
 * Bilingual announcement browser flows: strict validation, per-language
 * banners with an explicit fallback notice, localized email, retract and
 * dismiss remaining stable across a language switch.
 */

const RU = {
  title: "Плановые работы",
  body: "Сервер будет недоступен сегодня вечером.",
};

async function setLocale(
  admin: Parameters<typeof createUserViaAdmin>[0],
  user: { email: string; password: string | null },
  locale: "en" | "ru",
) {
  const loginResponse = await admin.post("/api/v1/auth/login", {
    data: { email: user.email, password: user.password ?? password },
  });
  expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
  const { accessToken } = (await loginResponse.json()) as {
    accessToken: string;
  };
  const patched = await admin.patch("/api/v1/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { locale },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();
}

async function createAnnouncement(
  admin: Parameters<typeof createUserViaAdmin>[0],
  data: Record<string, unknown>,
) {
  const response = await admin.post("/api/v1/admin/announcements", { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string };
}

test("E1: EN user sees the RU original with an explicit fallback notice", async ({
  browser,
  admin,
  targetUser,
  testIp,
}) => {
  await setLocale(admin, targetUser, "en");
  const title = uniqueToken("ann-ru-only");
  await createAnnouncement(admin, {
    sourceLocale: "ru",
    fallbackPolicy: "allow_fallback",
    translations: { ru: { title, body: RU.body } },
    audience: "segment",
    segment: targetUser.email,
    active: true,
  });

  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, targetUser);
    const banner = userSide.page.getByTestId("announcement-banner");
    await expect(banner).toContainText(title);
    await expect(
      userSide.page.getByTestId(/announcement-fallback-/),
    ).toContainText("This announcement is available in Russian only.");
    await expect(
      userSide.page.getByText(title, { exact: true }),
    ).toHaveAttribute("lang", "ru");
    expect(await banner.locator("[data-tone]").count()).toBe(1);
  } finally {
    await userSide.context.close();
  }
});

test("E2: two users see their own language without notices", async ({
  browser,
  admin,
  targetUser,
  testIp,
}) => {
  const second = await createUserViaAdmin(admin, {
    email: `ann-ru-${randomUUID()}@e2e.example`,
    verified: true,
    password,
  });
  await setLocale(admin, targetUser, "en");
  await setLocale(admin, second, "ru");
  const enTitle = uniqueToken("ann-en");
  const ruTitle = uniqueToken("ann-ru");
  await createAnnouncement(admin, {
    sourceLocale: "en",
    fallbackPolicy: "require_all",
    translations: {
      en: { title: enTitle, body: "English body" },
      ru: { title: ruTitle, body: "Русский текст" },
    },
    audience: "segment",
    segment: `${targetUser.email},${second.email}`,
    active: true,
  });

  const enSide = await adminContext(browser, testIp);
  const ruSide = await adminContext(browser, testIp);
  try {
    await login(enSide.page, targetUser);
    await expect(enSide.page.getByTestId("announcement-banner")).toContainText(
      enTitle,
    );
    await expect(enSide.page.getByTestId(/announcement-fallback-/)).toHaveCount(
      0,
    );

    await login(ruSide.page, { email: second.email, password });
    await expect(ruSide.page.getByTestId("announcement-banner")).toContainText(
      ruTitle,
    );
    await expect(ruSide.page.getByTestId(/announcement-fallback-/)).toHaveCount(
      0,
    );
    expect(
      await ruSide.page.evaluate(() => document.documentElement.lang),
    ).toBe("ru");
  } finally {
    await enSide.context.close();
    await ruSide.context.close();
  }
});

test("E3: strict policy blocks publish until both languages are filled", async ({
  page,
}) => {
  const title = uniqueToken("ann-strict");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-announcement-new").click();

  await page.getByTestId("announcement-tab-ru").click();
  await page.getByTestId("admin-announcement-title-ru").fill(title);
  await page.getByTestId("admin-announcement-body-ru").fill(RU.body);
  await expect(page.getByTestId("announcement-status-en")).toContainText(
    "Not filled",
  );
  await expect(page.getByTestId("announcement-status-ru")).toContainText(
    "Ready",
  );
  await expect(page.getByTestId("admin-announcement-publish")).toBeDisabled();
  await expect(page.getByTestId("admin-announcement-save-draft")).toBeEnabled();

  await page.getByTestId("announcement-policy-allow_fallback").check();
  await expect(page.getByTestId("announcement-preview-banner")).toContainText(
    title,
  );
  await expect(
    page
      .getByTestId("announcement-preview-banner")
      .getByText("This announcement is available in Russian only."),
  ).toBeVisible();

  await page.getByTestId("announcement-policy-require_all").check();
  await page.getByTestId("announcement-tab-en").click();
  await page.getByTestId("admin-announcement-title").fill(`EN ${title}`);
  await page.getByTestId("admin-announcement-body").fill("English body");
  await expect(page.getByTestId("admin-announcement-publish")).toBeEnabled();
});

test("E4: localized email keeps the fallback notice for an EN recipient", async ({
  admin,
  targetUser,
}) => {
  await setLocale(admin, targetUser, "en");
  const title = uniqueToken("ann-mail");
  await createAnnouncement(admin, {
    sourceLocale: "ru",
    fallbackPolicy: "allow_fallback",
    translations: { ru: { title, body: RU.body } },
    audience: "segment",
    segment: targetUser.email,
    active: true,
    sendEmail: true,
  });

  const message = await waitForMessage(admin, {
    to: targetUser.email,
    subjectIncludes: "Announcement (Russian only)",
  });
  expect(message.subject).toContain(title);
  expect(message.text).toContain(
    "This announcement is available in Russian only.",
  );
  expect(message.html).toContain(
    "This announcement is available in Russian only.",
  );
});

test("E5: edits leave the other language intact and retract hides both", async ({
  browser,
  admin,
  targetUser,
  testIp,
}) => {
  await setLocale(admin, targetUser, "en");
  const enTitle = uniqueToken("ann-before");
  const announcement = await createAnnouncement(admin, {
    sourceLocale: "en",
    fallbackPolicy: "require_all",
    translations: {
      en: { title: enTitle, body: "English body" },
      ru: { title: "До правки", body: "Русский текст" },
    },
    audience: "segment",
    segment: targetUser.email,
    active: true,
  });

  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, targetUser);
    const banner = userSide.page.getByTestId("announcement-banner");
    await expect(banner).toContainText(enTitle);

    await admin.patch(`/api/v1/admin/announcements/${announcement.id}`, {
      data: {
        translations: { ru: { title: "После правки", body: "Новый текст" } },
      },
    });
    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(banner).toContainText(enTitle);
    await expect(banner).not.toContainText("После правки");

    await admin.patch(`/api/v1/admin/announcements/${announcement.id}`, {
      data: { active: false },
    });
    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(userSide.page.getByTestId("announcement-banner")).toHaveCount(
      0,
    );
  } finally {
    await userSide.context.close();
  }
});
