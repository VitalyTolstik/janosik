import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { BroadcastQueueService } from "@/ops/broadcast-queue.service";
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
  let broadcasts: BroadcastQueueService;
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
  const dismiss = (token: string, id: string, version: number) =>
    server()
      .post(`/api/v1/announcements/${id}/dismiss`)
      .set(auth(token))
      .send({ version });

  /** Background fan-out: poll the in-memory outbox instead of assuming sync. */
  const waitForOutbox = async (
    predicate: (mail: (typeof mailer.outbox)[number]) => boolean,
    timeoutMs = 2_000,
  ) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const mail = mailer.outbox.find(predicate);
      if (mail) return mail;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return undefined;
  };
  const waitForOutboxCount = (count: number, timeoutMs = 2_000) =>
    waitForOutbox(() => mailer.outbox.length >= count, timeoutMs).then(
      () => mailer.outbox.length,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);
    broadcasts = app.get(BroadcastQueueService);
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
    expect(res.body).toMatchObject({
      code: "announcement_translations_incomplete",
      missingLocales: ["en"],
      retryable: false,
      requestId: res.headers["x-request-id"],
      currentVersion: null,
    });
    expect(res.body.details?.missingLocales).toBeUndefined();
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
    const invalidQuery = await active(ruToken, "?locale=fr").expect(200);
    expect(invalidQuery.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "ru",
      requestedLocale: "ru",
    });
    const byHeader = await active(nullToken, "", "ru-RU,ru;q=0.9").expect(200);
    expect(byHeader.body[0]).toMatchObject({
      id: created.body.id,
      contentLocale: "ru",
      requestedLocale: "ru",
    });
  });

  it("keeps the old payload as a true language-unknown legacy row", async () => {
    const title = "Плановые работы";
    const body = "Сервер будет недоступен сегодня вечером.";
    const created = await postAnnouncement({
      title,
      body,
      sendEmail: true,
    }).expect(201);
    expect(created.body.sourceLocale).toBeNull();
    expect(created.body.fallbackPolicy).toBe("allow_fallback");
    expect(created.body.translations).toEqual([]);
    expect(created.body.title).toBe(title);
    expect(created.body.emailSentAt).toEqual(expect.any(Number));

    const en = await active(enToken, "?locale=en").expect(200);
    expect(
      en.body.find((item: { id: string }) => item.id === created.body.id),
    ).toMatchObject({
      title,
      body,
      contentLocale: null,
      requestedLocale: "en",
      isFallback: false,
    });
    const ru = await active(ruToken, "?locale=ru").expect(200);
    expect(
      ru.body.find((item: { id: string }) => item.id === created.body.id),
    ).toMatchObject({
      title,
      contentLocale: null,
      requestedLocale: "ru",
      isFallback: false,
    });

    const toEn = await waitForOutbox((mail) => mail.to === EN_EMAIL);
    expect(toEn?.subject).toBe(title);
    expect(toEn?.text).toContain(body);
    expect(toEn?.text).not.toContain("available in");
    const toRu = await waitForOutbox((mail) => mail.to === RU_EMAIL);
    expect(toRu?.subject).toBe(title);
    expect(toRu?.text).not.toContain("доступно только");

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
      version: legacy.version,
    });
  });

  it("rejects a stale edit and preserves the other admin's language", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: false,
    }).expect(201);
    const staleVersion = created.body.version as number;

    const first = await patchAnnouncement(created.body.id as string, {
      translations: {
        ru: { title: "RU admin A", body: "Правка первого админа" },
      },
      version: staleVersion,
    }).expect(200);
    expect(first.body.version).toBe(staleVersion + 1);

    const stale = await patchAnnouncement(created.body.id as string, {
      translations: {
        en: { title: "EN admin B", body: "Second admin edit" },
      },
      version: staleVersion,
    }).expect(409);
    expect(stale.body.conflict).toBe("version");
    expect(stale.body.currentVersion).toBe(staleVersion + 1);

    await patchAnnouncement(created.body.id as string, {
      translations: {
        en: { title: "EN admin B", body: "Second admin edit" },
      },
      version: first.body.version as number,
    }).expect(200);

    const list = await server()
      .get("/api/v1/admin/announcements")
      .set(admin())
      .expect(200);
    const row = list.body.find(
      (item: { id: string }) => item.id === created.body.id,
    );
    expect(row.translations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locale: "ru", title: "RU admin A" }),
        expect.objectContaining({ locale: "en", title: "EN admin B" }),
      ]),
    );
  });

  it("treats null translations as an omitted patch and requires a source with translations", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: false,
    }).expect(201);
    await patchAnnouncement(created.body.id as string, {
      translations: null,
      version: created.body.version,
    }).expect(200);

    const legacy = await prisma.announcement.create({
      data: {
        title: "Legacy",
        body: "Legacy body",
        sourceLocale: null,
        fallbackPolicy: "allow_fallback",
        createdBy: OWNER_EMAIL,
      },
    });
    const res = await patchAnnouncement(legacy.id, {
      translations: both,
    }).expect(400);
    expect(res.body.code).toBe("announcement_source_locale_required");
  });

  it("migrates legacy text when the source language is chosen and clears old columns", async () => {
    const created = await postAnnouncement({
      title: "Старый текст",
      body: "Старое тело",
    }).expect(201);
    expect(created.body.sourceLocale).toBeNull();
    expect(created.body.translations).toEqual([]);

    const migrated = await patchAnnouncement(created.body.id as string, {
      sourceLocale: "ru",
      fallbackPolicy: "require_all",
      translations: { ru: both.ru, en: both.en },
      version: created.body.version,
    }).expect(200);
    expect(migrated.body.sourceLocale).toBe("ru");
    expect(migrated.body.title).toBe(both.ru.title);
    const stored = await prisma.announcement.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(stored.title).toBeNull();
    expect(stored.body).toBeNull();
  });

  it("refuses strict policy on a language-unknown legacy row", async () => {
    const created = await postAnnouncement({
      title: "Legacy strict",
      body: "Still legacy",
      active: false,
    }).expect(201);
    const res = await patchAnnouncement(created.body.id as string, {
      fallbackPolicy: "require_all",
      version: created.body.version,
    }).expect(400);
    expect(res.body.code).toBe("announcement_source_locale_required");
  });

  it("rejects enabling email on an already-active announcement", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: true,
      sendEmail: false,
    }).expect(201);
    const res = await patchAnnouncement(created.body.id as string, {
      sendEmail: true,
      version: created.body.version,
    }).expect(400);
    expect(res.body.code).toBe("announcement_email_active_noop");
  });

  it("returns before email fan-out and claims emailSentAt once", async () => {
    const gate = new Promise<void>(() => undefined);
    const enqueue = jest.spyOn(broadcasts, "enqueue").mockReturnValue(gate);
    const started = Date.now();
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: true,
      sendEmail: true,
    }).expect(201);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(created.body.emailSentAt).toEqual(expect.any(Number));
    enqueue.mockRestore();

    const again = jest.spyOn(broadcasts, "enqueue");
    await patchAnnouncement(created.body.id as string, {
      active: true,
      version: created.body.version,
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(again).not.toHaveBeenCalled();
    again.mockRestore();
  });

  it("audits only the locales that actually changed", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      active: false,
    }).expect(201);
    await patchAnnouncement(created.body.id as string, {
      translations: {
        ru: { title: "Новая RU", body: "Новое тело" },
      },
      version: created.body.version,
    }).expect(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        action: "announcement.updated",
        targetId: created.body.id as string,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.details).toMatchObject({ changedLocales: ["ru"] });
    expect(JSON.stringify(audit?.details)).not.toContain("Новое тело");
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

    const toRu = await waitForOutbox((mail) => mail.to === RU_EMAIL);
    expect(toRu?.subject).toBe(both.ru.title);
    expect(toRu?.text).toContain(both.ru.body);
    expect(toRu?.text).not.toContain("доступно только");

    const toEn = await waitForOutbox((mail) => mail.to === EN_EMAIL);
    expect(toEn?.subject).toBe(`Announcement (Russian only): ${both.ru.title}`);
    expect(toEn?.text).toContain(
      "This announcement is available in Russian only.",
    );
    expect(toEn?.html).toContain('lang="ru"');
    expect(toEn?.html).toContain(
      "This announcement is available in Russian only.",
    );

    // Anonymous-to-localization recipients default to English.
    const toNull = await waitForOutbox((mail) => mail.to === NULL_EMAIL);
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

    const toEn = await waitForOutbox((mail) => mail.to === EN_EMAIL);
    expect(toEn?.subject).toBe(both.en.title);
    expect(toEn?.text).toContain(both.en.body);
    expect(toEn?.text).not.toContain("Russian only");
    expect(mailer.outbox.filter((mail) => mail.to === EN_EMAIL)).toHaveLength(
      1,
    );

    const toRu = await waitForOutbox((mail) => mail.to === RU_EMAIL);
    expect(toRu?.subject).toBe(both.ru.title);
    expect(toRu?.text).toContain(both.ru.body);
    expect(toRu?.text).not.toContain("доступно только");
    expect(mailer.outbox.filter((mail) => mail.to === RU_EMAIL)).toHaveLength(
      1,
    );
  });

  it("skips disabled recipients and keeps external segment addresses", async () => {
    const disabledEmail = "ann-disabled@example.com";
    const externalEmail = "outside@example.com";
    await prisma.user.create({
      data: {
        email: disabledEmail,
        passwordHash: "not-used",
        disabledAt: new Date(),
      },
    });
    await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "allow_fallback",
      translations: { en: both.en },
      audience: "segment",
      segment: `${EN_EMAIL}, ${disabledEmail}, ${externalEmail}`,
      active: true,
      sendEmail: true,
    }).expect(201);

    expect(await waitForOutbox((mail) => mail.to === EN_EMAIL)).toBeDefined();
    expect(
      await waitForOutbox((mail) => mail.to === externalEmail),
    ).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailer.outbox.some((mail) => mail.to === disabledEmail)).toBe(false);
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
    await waitForOutboxCount(1);
    expect(mailer.outbox.length).toBeGreaterThan(0);
    expect(activated.body.emailSentAt).toEqual(expect.any(Number));

    const before = mailer.outbox.length;
    await patchAnnouncement(created.body.id as string, {
      translations: { en: { title: "Updated", body: "Updated body" } },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
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

  it("keeps a dismissal per user across logins and re-shows an edited version", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
    }).expect(201);
    const id = created.body.id as string;
    const version = created.body.version as number;
    expect(version).toBe(1);

    const before = await active(enToken, "?locale=en").expect(200);
    expect(
      before.body.find((item: { id: string }) => item.id === id),
    ).toMatchObject({ id, version });

    await dismiss(enToken, id, version)
      .expect(200)
      .expect({ dismissed: true, version });

    const afterA = await active(enToken, "?locale=en").expect(200);
    expect(
      afterA.body.find((item: { id: string }) => item.id === id),
    ).toBeUndefined();
    const afterB = await active(ruToken, "?locale=ru").expect(200);
    expect(
      afterB.body.find((item: { id: string }) => item.id === id),
    ).toMatchObject({ id, version });

    const relogin = await server()
      .post("/api/v1/auth/login")
      .send({ email: EN_EMAIL, password: USER_PASSWORD })
      .expect(200);
    const afterRelogin = await active(
      relogin.body.accessToken as string,
      "?locale=en",
    ).expect(200);
    expect(
      afterRelogin.body.find((item: { id: string }) => item.id === id),
    ).toBeUndefined();

    const patched = await patchAnnouncement(id, {
      translations: { en: { title: "Updated", body: "Updated body" } },
      version,
    }).expect(200);
    expect(patched.body.version).toBe(version + 1);

    const afterEdit = await active(enToken, "?locale=en").expect(200);
    expect(
      afterEdit.body.find((item: { id: string }) => item.id === id),
    ).toMatchObject({ id, title: "Updated", version: version + 1 });

    const stale = await dismiss(enToken, id, version).expect(409);
    expect(stale.body).toMatchObject({
      conflict: "version",
      currentVersion: version + 1,
    });

    await dismiss(enToken, id, version + 1).expect(200);
    const afterSecondDismiss = await active(enToken, "?locale=en").expect(200);
    expect(
      afterSecondDismiss.body.find((item: { id: string }) => item.id === id),
    ).toBeUndefined();
  });

  it("is idempotent and hides only the dismissed announcement", async () => {
    const first = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
    }).expect(201);
    const sibling = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
    }).expect(201);

    const id = first.body.id as string;
    const version = first.body.version as number;
    await dismiss(enToken, id, version).expect(200);
    await dismiss(enToken, id, version).expect(200);
    expect(
      await prisma.announcementDismissal.count({
        where: { announcementId: id },
      }),
    ).toBe(1);

    const list = await active(enToken, "?locale=en").expect(200);
    expect(
      list.body.find((item: { id: string }) => item.id === id),
    ).toBeUndefined();
    expect(
      list.body.find(
        (item: { id: string }) => item.id === (sibling.body.id as string),
      ),
    ).toMatchObject({ id: sibling.body.id, version: sibling.body.version });
  });

  it("does not reveal unaddressed, inactive or out-of-window announcements", async () => {
    const segment = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "segment",
      segment: RU_EMAIL,
      active: true,
    }).expect(201);
    await dismiss(enToken, segment.body.id as string, 1).expect(404);

    const inactive = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: false,
    }).expect(201);
    await dismiss(enToken, inactive.body.id as string, 1).expect(404);

    const now = Date.now();
    const expired = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
      startsAt: now - 10_000,
      endsAt: now - 5_000,
    }).expect(201);
    await dismiss(enToken, expired.body.id as string, 1).expect(404);

    await dismiss(enToken, "announcement-does-not-exist", 1).expect(404);
    await server()
      .post(`/api/v1/announcements/${segment.body.id as string}/dismiss`)
      .send({ version: 1 })
      .expect(401);
  });

  it("rejects a missing or invalid dismissal version", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
    }).expect(201);
    const id = created.body.id as string;

    await server()
      .post(`/api/v1/announcements/${id}/dismiss`)
      .set(auth(enToken))
      .send({})
      .expect(400);
    await dismiss(enToken, id, 0).expect(400);
    await server()
      .post(`/api/v1/announcements/${id}/dismiss`)
      .set(auth(enToken))
      .send({ version: "1" })
      .expect(400);
  });

  it("cascades dismissals when the announcement is deleted", async () => {
    const created = await postAnnouncement({
      sourceLocale: "en",
      fallbackPolicy: "require_all",
      translations: both,
      audience: "all",
      active: true,
    }).expect(201);
    const id = created.body.id as string;
    await dismiss(enToken, id, created.body.version as number).expect(200);
    expect(
      await prisma.announcementDismissal.count({
        where: { announcementId: id },
      }),
    ).toBe(1);

    await server()
      .delete(`/api/v1/admin/announcements/${id}`)
      .set(admin())
      .expect(200);
    expect(
      await prisma.announcementDismissal.count({
        where: { announcementId: id },
      }),
    ).toBe(0);
  });

  it("keeps writes owner-only", async () => {
    await server()
      .post("/api/v1/admin/announcements")
      .set(admin(operatorToken))
      .send({ title: "No", body: "No" })
      .expect(403);

    const created = await postAnnouncement({
      title: "Owner only",
      body: "Owner only body",
      active: false,
    }).expect(201);
    await server()
      .patch(`/api/v1/admin/announcements/${created.body.id}`)
      .set(admin(operatorToken))
      .send({ active: true })
      .expect(403);
    await server()
      .delete(`/api/v1/admin/announcements/${created.body.id}`)
      .set(admin(operatorToken))
      .expect(403);
  });
});
