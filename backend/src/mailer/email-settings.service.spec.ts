import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { EmailSettingsService } from "./email-settings.service";
import { MailerService } from "./mailer.service";
import { encryptSecret } from "./secret-box";

const prismaMock = {
  emailSettings: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService & {
  emailSettings: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
};

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: "singleton",
  provider: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  from: "Janosik <no-reply@example.com>",
  username: "you@gmail.com",
  passwordEnc: null,
  enabled: false,
  lastTestAt: null,
  lastTestOk: null,
  lastError: null,
  updatedBy: null,
  updatedAt: new Date("2026-09-22T00:00:00Z"),
  ...overrides,
});

describe("EmailSettingsService", () => {
  // vi.unstubAllGlobals comes from each ethereal test's afterEach.
  let mailer: MailerService;
  let service: EmailSettingsService;
  // Tiny in-memory stand-in for the singleton row: findUnique reads it,
  // upsert merges into it, so post-update getPublic sees the saved row.
  let savedRow: Record<string, unknown> | null;

  beforeEach(() => {
    jest.clearAllMocks();
    savedRow = null;
    prismaMock.emailSettings.findUnique.mockImplementation(
      async () => savedRow,
    );
    prismaMock.emailSettings.upsert.mockImplementation(
      async ({ create, update }) => {
        savedRow = makeRow({ ...(savedRow ?? {}), ...(create ?? update) });
        return savedRow;
      },
    );
    mailer = new MailerService();
    service = new EmailSettingsService(prismaMock, mailer);
  });

  describe("getPublic", () => {
    // The spec runs with or without a configured SMTP_* env (dev machine
    // has one, CI does not), so boot-state assertions stay relative.
    it("mirrors the env bootstrap when nothing is saved", async () => {
      const dto = await service.getPublic();

      expect(dto.source).toBe(mailer.enabled ? "env" : "none");
      expect(dto.active).toBe(mailer.enabled);
      expect(dto.hasPassword).toBe(false);
    });

    it("masks the stored password behind hasPassword", async () => {
      savedRow = makeRow({ passwordEnc: "ZW5jcnlwdGVk", enabled: true });

      const dto = await service.getPublic();

      expect(dto.hasPassword).toBe(true);
      expect(JSON.stringify(dto)).not.toContain("ZW5jcnlwdGVk");
    });
  });

  describe("update", () => {
    it("takes host/port/secure from the preset, ignoring client values", async () => {
      await service.update(
        {
          provider: "gmail",
          host: "evil.example.com",
          port: 2525,
          secure: false,
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          password: "app password",
          enabled: true,
        },
        "owner@example.com",
      );

      const saved = prismaMock.emailSettings.upsert.mock.calls[0][0].create;
      expect(saved.host).toBe("smtp.gmail.com");
      expect(saved.port).toBe(465);
      expect(saved.secure).toBe(true);
    });

    it("rejects an unknown provider", async () => {
      await expect(
        service.update(
          {
            provider: "aol" as "gmail",
            from: "Janosik <no-reply@example.com>",
            username: "user",
            enabled: false,
          },
          "owner@example.com",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("requires host/port for the custom provider", async () => {
      await expect(
        service.update(
          {
            provider: "custom",
            from: "Janosik <no-reply@example.com>",
            username: "user",
            enabled: false,
          },
          "owner@example.com",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses to enable delivery without any password", async () => {
      await expect(
        service.update(
          {
            provider: "gmail",
            from: "Janosik <no-reply@example.com>",
            username: "you@gmail.com",
            enabled: true,
          },
          "owner@example.com",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("encrypts the password, swaps the transport on and stays enabled", async () => {
      const dto = await service.update(
        {
          provider: "gmail",
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          password: "app password",
          enabled: true,
        },
        "owner@example.com",
      );

      const saved = prismaMock.emailSettings.upsert.mock.calls[0][0].create;
      expect(saved.passwordEnc).toBeTruthy();
      expect(saved.passwordEnc).not.toContain("app password");
      expect(mailer.enabled).toBe(true);
      expect(dto.enabled).toBe(true);
      expect(dto.source).toBe("db");
      expect(dto.active).toBe(true);
    });

    it("keeps the stored password when the request omits it", async () => {
      savedRow = makeRow({
        passwordEnc: encryptSecret("stored app password"),
        enabled: true,
      });

      await service.update(
        {
          provider: "gmail",
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          enabled: true,
        },
        "owner@example.com",
      );

      const saved = prismaMock.emailSettings.upsert.mock.calls[0][0].update;
      expect(saved.passwordEnc).toBe(savedRow?.passwordEnc);
      expect(mailer.enabled).toBe(true);
    });

    it("disabling falls back to log mode but keeps the credentials", async () => {
      savedRow = makeRow({ passwordEnc: "ZW5jcnlwdGVk", enabled: true });

      const dto = await service.update(
        {
          provider: "gmail",
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          enabled: false,
        },
        "owner@example.com",
      );

      expect(mailer.enabled).toBe(false);
      expect(dto.hasPassword).toBe(true);
      expect(dto.active).toBe(false);
    });

    it("a change resets the recorded test outcome", async () => {
      savedRow = makeRow({ passwordEnc: "ZW5jcnlwdGVk" });

      await service.update(
        {
          provider: "gmail",
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          enabled: false,
        },
        "owner@example.com",
      );

      const saved = prismaMock.emailSettings.upsert.mock.calls[0][0].update;
      expect(saved.lastTestOk).toBeNull();
      expect(saved.lastTestAt).toBeNull();
    });
  });

  describe("test", () => {
    it("in log mode the probe lands in the outbox and reports ok", async () => {
      mailer.reconfigure(null, "Janosik <no-reply@example.com>");
      savedRow = makeRow();

      const result = await service.test("owner@example.com");

      expect(result).toEqual({ ok: true, error: null });
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe("owner@example.com");
      expect(prismaMock.emailSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastTestOk: true }),
        }),
      );
    });

    it("a dead transport reports the error without throwing", async () => {
      savedRow = makeRow({ passwordEnc: "ZW5jcnlwdGVk", enabled: true });
      jest.spyOn(mailer, "send").mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await service.test("owner@example.com");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(prismaMock.emailSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastTestOk: false }),
        }),
      );
    });

    it("does not record a probe when only the env bootstrap exists", async () => {
      mailer.reconfigure(null, "Janosik <no-reply@example.com>");

      const result = await service.test("owner@example.com");

      expect(result.ok).toBe(true);
      expect(prismaMock.emailSettings.update).not.toHaveBeenCalled();
    });
  });

  describe("ethereal sandbox provider", () => {
    const etherealResponse = (user: string, pass: string) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          user,
          pass,
          web: "https://ethereal.email",
        }),
      }) as unknown as Response;
    const realFetch = globalThis.fetch;
    const stubFetch = (impl: jest.Mock) => {
      globalThis.fetch = impl as unknown as typeof fetch;
    };

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it("mints a sandbox account on save and exposes its web login to owners", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          etherealResponse("sandbox-1@ethereal.email", "pass-1"),
        );
      stubFetch(fetchMock);

      const dto = await service.update(
        { provider: "ethereal", from: "", username: "", enabled: true },
        "owner@example.com",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(dto).toMatchObject({
        provider: "ethereal",
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        username: "sandbox-1@ethereal.email",
        from: "Janosik <sandbox-1@ethereal.email>",
        enabled: true,
        hasPassword: true,
        active: true,
      });
      expect(dto.webViewer).toEqual({
        url: "https://ethereal.email",
        user: "sandbox-1@ethereal.email",
        pass: "pass-1",
      });
      expect(mailer.enabled).toBe(true);
    });

    it("hides the web login from operators", async () => {
      savedRow = makeRow({
        provider: "ethereal",
        username: "sandbox-1@ethereal.email",
        passwordEnc: encryptSecret("pass-1"),
        enabled: true,
      });

      const operatorView = await service.getPublic(false);
      expect(operatorView.webViewer).toBeNull();

      const ownerView = await service.getPublic(true);
      expect(ownerView.webViewer).toMatchObject({
        user: "sandbox-1@ethereal.email",
        pass: "pass-1",
      });
    });

    it("reuses the stored sandbox account on later saves", async () => {
      savedRow = makeRow({
        provider: "ethereal",
        username: "sandbox-1@ethereal.email",
        from: "Janosik <sandbox-1@ethereal.email>",
        passwordEnc: encryptSecret("pass-1"),
        enabled: true,
      });
      const fetchMock = jest.fn();
      stubFetch(fetchMock);

      const dto = await service.update(
        { provider: "ethereal", from: "", username: "", enabled: true },
        "owner@example.com",
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(dto.username).toBe("sandbox-1@ethereal.email");
      expect(dto.webViewer).toMatchObject({ pass: "pass-1" });
    });

    it("a fresh ethereal save after another provider mints a new account", async () => {
      savedRow = makeRow({
        provider: "gmail",
        username: "you@gmail.com",
        passwordEnc: encryptSecret("gmail pass"),
      });
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          etherealResponse("sandbox-2@ethereal.email", "pass-2"),
        );
      stubFetch(fetchMock);

      const dto = await service.update(
        { provider: "ethereal", from: "", username: "", enabled: false },
        "owner@example.com",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(dto.username).toBe("sandbox-2@ethereal.email");
      expect(dto.enabled).toBe(false);
      expect(mailer.enabled).toBe(false);
    });

    it("an API failure answers 400 and stores nothing", async () => {
      stubFetch(jest.fn().mockRejectedValue(new Error("network down")));

      await expect(
        service.update(
          { provider: "ethereal", from: "", username: "", enabled: true },
          "owner@example.com",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.emailSettings.upsert).not.toHaveBeenCalled();
    });
  });

  describe("onModuleInit", () => {
    it("re-applies a saved enabled row after a restart", async () => {
      await service.update(
        {
          provider: "gmail",
          from: "Janosik <no-reply@example.com>",
          username: "you@gmail.com",
          password: "app password",
          enabled: true,
        },
        "owner@example.com",
      );
      const savedEnc = savedRow?.passwordEnc as string;

      // A fresh process: the saved row must bring the gmail transport back
      // regardless of what the env bootstrap had configured.
      const restartedMailer = new MailerService();
      const reconfigureSpy = jest.spyOn(restartedMailer, "reconfigure");
      const restarted = new EmailSettingsService(prismaMock, restartedMailer);
      savedRow = makeRow({ passwordEnc: savedEnc, enabled: true });

      await restarted.onModuleInit();

      expect(reconfigureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          username: "you@gmail.com",
          password: "app password",
        }),
        "Janosik <no-reply@example.com>",
      );
      expect(restartedMailer.enabled).toBe(true);
    });

    it("ignores a disabled row", async () => {
      mailer.reconfigure(null, "Janosik <no-reply@example.com>");
      savedRow = makeRow({ passwordEnc: "ZW5jcnlwdGVk", enabled: false });

      await service.onModuleInit();

      expect(mailer.enabled).toBe(false);
    });
  });
});
