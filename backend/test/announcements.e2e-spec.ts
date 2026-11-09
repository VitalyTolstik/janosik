import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "ann-owner@example.com";
const OWNER_PASSWORD = "owner correct horse battery";
const OPERATOR_EMAIL = "ann-operator@example.com";
const OPERATOR_PASSWORD = "operator correct horse battery";
const EN_EMAIL = "ann-en@example.com";
const RU_EMAIL = "ann-ru@example.com";
const NULL_EMAIL = "ann-null@example.com";
const USER_PASSWORD = "user correct horse battery";

/**
 * Bilingual announcements (end to end): strict/fallback publishing, locale
 * resolution, localized email with an explicit fallback notice, draft
 * activation, legacy rows, search and audit.
 */
describe("Announcements (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let ownerToken: string;
  let operatorToken: string;
  let enToken: string;
  let ruToken: string;
  let nullToken: string;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admin = (token = ownerToken) => ({
    Authorization: `Bearer ${token}`,
  });

  const postAnnouncement = (body: Record<string, unknown>) =>
    server().post("/api/v1/admin/announcements").set(admin()).send(body);
  const patchAnnouncement = (id: string, body: Record<string, unknown>) =>
    server().patch(`/api/v1/admin/announcements/${id}`).set(admin()).send(body);
  const active = (token: string, query = "", acceptLanguage?: string) => {
    const req = server()
      .get(`/api/v1/announcements/active${query}`)
      .set(auth(token));
    if (acceptLanguage) req.set("Accept-Language", acceptLanguage);
    return req;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);
    await wipeAll(prisma);

    const passwordHash = await argonHash(USER_PASSWORD, { type: argon2id });
    await prisma.adminUser.createMany({
      data: [
        {
          email: OWNER_EMAIL,
          role: "OWNER",
          passwordHash: await argonHash(OWNER_PASSWORD, { type: argon2id }),
        },
        {
          email: OPERATOR_EMAIL,
          role: "OPERATOR",
          passwordHash: await argonHash(OPERATOR_PASSWORD, {
            type: argon2id,
          }),
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        { email: EN_EMAIL, passwordHash, locale: "en" },
        { email: RU_EMAIL, passwordHash, locale: "ru" },
        { email: NULL_EMAIL, passwordHash },
      ],
    });

    const adminLogin = (email: string, password: string) =>
      server()
        .post("/api/v1/admin/auth/login")
        .send({ email, password })
        .expect(200);
    ownerToken = (await adminLogin(OWNER_EMAIL, OWNER_PASSWORD)).body
      .accessToken;
    operatorToken = (await adminLogin(OPERATOR_EMAIL, OPERATOR_PASSWORD)).body
      .accessToken;
    const userLogin = (email: string) =>
      server()
        .post("/api/v1/auth/login")
        .send({ email, password: USER_PASSWORD })
        .expect(200);
    enToken = (await userLogin(EN_EMAIL)).body.accessToken;
    ruToken = (await userLogin(RU_EMAIL)).body.accessToken;
    nullToken = (await userLogin(NULL_EMAIL)).body.accessToken;

    // Log mode normally suppresses delivery; the outbox still records the
    // rendered letter, so the test can assert per-recipient localization.
    jest.spyOn(mailer, "enabled", "get").mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.announcement.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    mailer.outbox.length = 0;
  });

  const both = {
    en: {
      title: "Scheduled maintenance",
      body: "The server is read-only tonight.",
    },
    ru: {
      title: "Плановые работы",
      body: "Сегодня сервер доступен только для чтения.",
    },
  };

  it("blocks strict publication when one language is missing", async () => {
    const res = await postAnnouncement({
      sourceLocale: "ru",
      fallbackPolicy: "require_all",
      translations: { ru: both.ru },
      active: true,
    }).expect(400);
    expect(res.body.code).toBe("announcement_translations_incomplete");
    expect(res.body.missingLocales).toEqual(["en"]);
  });

  it("saves a one-language draft and publishes it after the second language arrives", async () => {
    const created = await postAnnouncement({
      sourceLocale: "ru",
      fallbackPolicy: "require_all",
      translations: { ru: both.ru },
      active: false,
    }).expect(201);
    expect(created.body.active).toBe(false);
    expect(created.body.completeness).toEqual({ en: false, ru: true });

    const published = await patchAnnouncement(created.body.id as string, {
      translations: { en: both.en },
      active: true,
    }).expect(200);
    expect(published.body.active).toBe(true);
    expect(published.body.completeness).toEqual({ en: true, ru: true });
  });

  it("serves each viewer their exact language", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: true,
    }).expect(201);

    const en = await active(enToken, "?locale=en").expect(200);
    expect(en.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: both.en.title,
        contentLocale: "en",
        requestedLocale: "en",
        isFallback: false,
      }),
    ]);
    const ru = await active(ruToken, "?locale=ru").expect(200);
    expect(ru.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: both.ru.title,
        contentLocale: "ru",
        requestedLocale: "ru",
        isFallback: false,
      }),
    ]);
  });

  it("serves an explicit fallback for a single-language announcement", async () => {
    const created = await postAnnouncement({
      sourceLocale: "ru",
      fallbackPolicy: "allow_fallback",
      translations: { ru: both.ru },
      active: true,
    }).expect(201);

    const en = await active(enToken, "?locale=en").expect(200);
    expect(en.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: both.ru.title,
        contentLocale: "ru",
        requestedLocale: "en",
        isFallback: true,
      }),
    ]);
    const ru = await active(ruToken, "?locale=ru").expect(200);
    expect(ru.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "ru",
      isFallback: false,
    });
  });

  it("uses the account locale before Accept-Language and accepts an explicit query", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: true,
    }).expect(201);

    const byProfile = await active(ruToken, "", "en-US,en;q=0.9").expect(200);
    expect(byProfile.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "ru",
      requestedLocale: "ru",
    });
    const byQuery = await active(ruToken, "?locale=en").expect(200);
    expect(byQuery.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "en",
      requestedLocale: "en",
    });
    const byHeader = await active(nullToken, "", "ru-RU,ru;q=0.9").expect(200);
    expect(byHeader.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "ru",
      requestedLocale: "ru",
    });
  });

  it("keeps legacy payloads and legacy rows readable", async () => {
    const created = await postAnnouncement({
      title: "Legacy title",
      body: "Legacy body",
    }).expect(201);
    expect(created.body.sourceLocale).toBe("en");
    expect(created.body.fallbackPolicy).toBe("allow_fallback");
    expect(created.body.translations).toEqual([
      expect.objectContaining({ locale: "en", title: "Legacy title" }),
    ]);

    const legacy = await prisma.announcement.create({
      data: {
        title: "Старое объявление",
        body: "Без известного языка",
        sourceLocale: null,
        fallbackPolicy: "allow_fallback",
        createdBy: OWNER_EMAIL,
      },
    });
    const res = await active(enToken, "?locale=en").expect(200);
    expect(res.body).toContainEqual({
      id: legacy.id,
      title: "Старое объявление",
      body: "Без известного языка",
      level: "info",
      contentLocale: null,
      requestedLocale: "en",
      isFallback: false,
    });
  });

  it("rejects an invalid window, a source deletion and a strict downgrade", async () => {
    const invalidWindow = await postAnnouncement({
      sourceLocale: "en",
      translations: { en: both.en },
      fallbackPolicy: "allow_fallback",
      startsAt: 2_000,
      endsAt: 1_000,
    }).expect(400);
    expect(invalidWindow.body.code).toBe("announcement_window_invalid");

    const created = await postAnnouncement({
      sourceLocale: "ru",
      fallbackPolicy: "allow_fallback",
      translations: { ru: both.ru },
      active: true,
    }).expect(201);
    const removeSource = await patchAnnouncement(created.body.id as string, {
      translations: { ru: null },
    }).expect(400);
    expect(removeSource.body.code).toBe(
      "announcement_source_translation_required",
    );

    const downgrade = await patchAnnouncement(created.body.id as string, {
      fallbackPolicy: "require_all",
    }).expect(400);
    expect(downgrade.body.code).toBe("announcement_translations_incomplete");
    expect(downgrade.body.missingLocales).toEqual(["en"]);
  });

  it("localizes the email per recipient and records emailSentAt", async () => {
    const created = await postAnnouncement({
      sourceLocale: "ru",
      fallbackPolicy: "allow_fallback",
      translations: { ru: both.ru },
      active: true,
      sendEmail: true,
    }).expect(201);
    expect(created.body.emailSentAt).toEqual(expect.any(Number));

    const toRu = mailer.outbox.find((mail) => mail.to === RU_EMAIL);
    expect(toRu?.subject).toBe(both.ru.title);
    expect(toRu?.text).toContain(both.ru.body);
    expect(toRu?.text).not.toContain("доступно только");

    const toEn = mailer.outbox.find((mail) => mail.to === EN_EMAIL);
    expect(toEn?.subject).toBe(`Announcement (Russian only): ${both.ru.title}`);
    expect(toEn?.text).toContain(
      "This announcement is available in Russian only.",
    );
    expect(toEn?.html).toContain('lang="ru"');
    expect(toEn?.html).toContain(
      "This announcement is available in Russian only.",
    );

    // Anonymous-to-localization recipients default to English.
    const toNull = mailer.outbox.find((mail) => mail.to === NULL_EMAIL);
    expect(toNull?.subject).toBe(
      `Announcement (Russian only): ${both.ru.title}`,
    );
  });

  it("sends each recipient their exact language when both exist", async () => {
    await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: true,
      sendEmail: true,
    }).expect(201);

    const toEn = mailer.outbox.find((mail) => mail.to === EN_EMAIL);
    expect(toEn?.subject).toBe(both.en.title);
    expect(toEn?.text).toContain(both.en.body);
    expect(toEn?.text).not.toContain("Russian only");

    const toRu = mailer.outbox.find((mail) => mail.to === RU_EMAIL);
    expect(toRu?.subject).toBe(both.ru.title);
    expect(toRu?.text).toContain(both.ru.body);
    expect(toRu?.text).not.toContain("доступно только");
  });

  it("never mails a draft, mails once on activation and not again on edits", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: false,
      sendEmail: true,
    }).expect(201);
    expect(mailer.outbox).toHaveLength(0);

    const activated = await patchAnnouncement(created.body.id as string, {
      active: true,
    }).expect(200);
    expect(mailer.outbox.length).toBeGreaterThan(0);
    expect(activated.body.emailSentAt).toEqual(expect.any(Number));

    const before = mailer.outbox.length;
    await patchAnnouncement(created.body.id as string, {
      translations: { en: { title: "Updated", body: "Updated body" } },
    }).expect(200);
    expect(mailer.outbox.length).toBe(before);
  });

  it("finds translated text in history and audits locales without bodies", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: false,
    }).expect(201);

    const page = await server()
      .get("/api/v1/admin/entities/announcements")
      .query({ search: "Плановые работы", limit: 20 })
      .set(admin())
      .expect(200);
    expect(page.body.items).toContainEqual(
      expect.objectContaining({ id: created.body.id }),
    );

    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        action: "announcement.created",
        targetId: created.body.id as string,
      },
    });
    expect(audit?.details).toMatchObject({
      sourceLocale: "en",
      locales: ["en", "ru"],
      fallbackPolicy: "require_all",
    });
    expect(JSON.stringify(audit?.details)).not.toContain(both.en.body);
  });

  it("keeps writes owner-only", async () => {
    await server()
      .post("/api/v1/admin/announcements")
      .set(admin(operatorToken))
      .send({ title: "No", body: "No" })
      .expect(403);
  });
});
