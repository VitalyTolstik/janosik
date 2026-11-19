import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import { createHmac } from "node:crypto";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AdminService } from "@/admin/admin.service";
import { decryptSecret, encryptSecret } from "@/mailer/secret-box";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "owner-1803@example.com";
const OPERATOR_EMAIL = "operator-1803@example.com";
const MASTER_PASSWORD = "master correct horse battery";
const VICTIM_PASSWORD = "victim correct horse battery";
const VICTIM_EMAIL = "victim-1803@example.com";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Minimal RFC 6238 code generator for the e2e proof paths. */
function totp(secretBase32: string, at = Date.now()): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secretBase32.replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const secret = Buffer.from(bytes);
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/**
 * H7/H8/M12 (TASK-180.3): the operator/owner boundary in the master panel.
 * OPERATOR keeps data access and non-credential moderation, but cannot move
 * another user's sign-in address, verify it, or hard-delete retained data.
 * Replacing 2FA requires the current factor or the account password.
 */
describe("Admin authz matrix (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let operatorToken: string;
  let ownerId: string;
  let victimId: string;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const passwordHash = await argonHash(MASTER_PASSWORD, { type: argon2id });
    const owner = await prisma.adminUser.create({
      data: {
        email: OWNER_EMAIL,
        displayName: "Owner",
        role: "OWNER",
        passwordHash,
      },
    });
    ownerId = owner.id;
    await prisma.adminUser.create({
      data: {
        email: OPERATOR_EMAIL,
        displayName: "Operator",
        role: "OPERATOR",
        passwordHash,
      },
    });
    const victim = await prisma.user.create({
      data: {
        email: VICTIM_EMAIL,
        displayName: "Victim",
        passwordHash: await argonHash(VICTIM_PASSWORD, { type: argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    victimId = victim.id;

    const ownerLogin = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: OWNER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);
    ownerToken = ownerLogin.body.accessToken as string;
    const operatorLogin = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: OPERATOR_EMAIL, password: MASTER_PASSWORD })
      .expect(200);
    operatorToken = operatorLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  describe("H7: account-takeover fields are OWNER-only", () => {
    it("refuses an operator changing a user's email", async () => {
      await server()
        .patch(`/api/v1/admin/users/${victimId}`)
        .set(auth(operatorToken))
        .send({ email: "operator-controlled@example.com" })
        .expect(403);

      const victim = await prisma.user.findUniqueOrThrow({
        where: { id: victimId },
      });
      expect(victim.email).toBe(VICTIM_EMAIL);
    });

    it("refuses an operator flipping the verification flag", async () => {
      await server()
        .patch(`/api/v1/admin/users/${victimId}`)
        .set(auth(operatorToken))
        .send({ emailVerified: false })
        .expect(403);
      const victim = await prisma.user.findUniqueOrThrow({
        where: { id: victimId },
      });
      expect(victim.emailVerifiedAt).not.toBeNull();
    });

    it("still lets an operator rename a user", async () => {
      const res = await server()
        .patch(`/api/v1/admin/users/${victimId}`)
        .set(auth(operatorToken))
        .send({ displayName: "Renamed by operator" })
        .expect(200);
      expect(res.body.displayName).toBe("Renamed by operator");
    });

    it("lets the owner move and verify the address, and audits it", async () => {
      const res = await server()
        .patch(`/api/v1/admin/users/${victimId}`)
        .set(auth(ownerToken))
        .send({ email: "victim-moved@example.com", emailVerified: true })
        .expect(200);
      expect(res.body.email).toBe("victim-moved@example.com");
      expect(res.body.emailVerifiedAt).toEqual(expect.any(Number));

      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "user.email_changed", targetId: victimId },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("H8: retention purge is OWNER-only", () => {
    it("refuses an operator", async () => {
      await server()
        .post("/api/v1/admin/retention/purge")
        .set(auth(operatorToken))
        .expect(403);
    });

    it("allows the owner", async () => {
      const res = await server()
        .post("/api/v1/admin/retention/purge")
        .set(auth(ownerToken))
        .expect(201);
      expect(res.body.affected).toEqual(expect.any(Number));
    });
  });

  describe("M12: replacing an active TOTP secret needs proof", () => {
    it("stages a proven replacement and audits it only after confirmation", async () => {
      const oldSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      await prisma.adminUser.update({
        where: { id: ownerId },
        data: {
          totpEnabled: true,
          totpSecretEnc: encryptSecret(oldSecret),
        },
      });

      const refused = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({})
        .expect(401);
      expect(refused.body.code).toBe("totp_proof_required");

      await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({ password: "wrong password" })
        .expect(401);

      const staged = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({ password: MASTER_PASSWORD })
        .expect(201);
      expect(staged.body.secret).toEqual(expect.any(String));
      expect(staged.body.setupToken).toEqual(expect.any(String));

      // The old factor is still active: a lost setup response cannot lock the
      // master out, and nothing is audited as replaced yet.
      let row = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(decryptSecret(row.totpSecretEnc!)).toBe(oldSecret);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "security.totp_replaced", targetId: ownerId },
        }),
      ).toBe(0);

      const adminService = app.get(AdminService);
      const invalidate = jest.spyOn(adminService, "invalidateMetrics");
      const confirmed = await server()
        .post("/api/v1/admin/security/totp/verify")
        .set(auth(ownerToken))
        .send({
          code: totp(staged.body.secret as string),
          setupToken: staged.body.setupToken,
        })
        .expect(201);
      expect(confirmed.body).toMatchObject({
        totpEnabled: true,
        replaced: true,
      });
      // The audit row was written in the secret transaction, outside the
      // normal audit helper, so the metrics cache must still be dropped.
      expect(invalidate).toHaveBeenCalled();
      invalidate.mockRestore();

      row = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(decryptSecret(row.totpSecretEnc!)).toBe(staged.body.secret);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "security.totp_replaced", targetId: ownerId },
        }),
      ).toBe(1);

      // The same code step must not be pre-consumed by the proof check: the
      // new factor has to work at the very next login.
      await server()
        .post("/api/v1/admin/auth/login")
        .send({
          email: OWNER_EMAIL,
          password: MASTER_PASSWORD,
          totpCode: totp(staged.body.secret as string),
        })
        .expect(200);
    });

    it("accepts the current code as proof and serializes concurrent replacement", async () => {
      const row = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      const current = decryptSecret(row.totpSecretEnc!);

      // The proof code is checked without recording its step, so it remains
      // usable for the next login.
      await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({ totpCode: totp(current) })
        .expect(201);

      const [first, second] = await Promise.all([
        server()
          .post("/api/v1/admin/security/totp")
          .set(auth(ownerToken))
          .send({ password: MASTER_PASSWORD })
          .expect(201),
        server()
          .post("/api/v1/admin/security/totp")
          .set(auth(ownerToken))
          .send({ password: MASTER_PASSWORD })
          .expect(201),
      ]);
      expect(first.body.setupToken).not.toBe(second.body.setupToken);

      // Staging does not touch the active factor; confirmation is row-locked.
      const stillCurrent = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(decryptSecret(stillCurrent.totpSecretEnc!)).toBe(current);

      const [firstConfirm, secondConfirm] = await Promise.all([
        server()
          .post("/api/v1/admin/security/totp/verify")
          .set(auth(ownerToken))
          .send({
            code: totp(first.body.secret as string),
            setupToken: first.body.setupToken,
          }),
        server()
          .post("/api/v1/admin/security/totp/verify")
          .set(auth(ownerToken))
          .send({
            code: totp(second.body.secret as string),
            setupToken: second.body.setupToken,
          }),
      ]);
      const winner =
        firstConfirm.status === 201
          ? {
              setup: first,
              response: firstConfirm,
              other: secondConfirm,
            }
          : {
              setup: second,
              response: secondConfirm,
              other: firstConfirm,
            };
      expect(winner.response.status).toBe(201);
      expect(winner.response.body).toMatchObject({
        totpEnabled: true,
        replaced: true,
      });
      expect(winner.other.status).toBe(409);
      expect(winner.other.body.code).toBe("setup_stale");

      const final = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(decryptSecret(final.totpSecretEnc!)).toBe(
        winner.setup.body.secret,
      );

      // A ticket is single-use even within its TTL: replaying the winner
      // changes nothing and is refused as stale.
      const replay = await server()
        .post("/api/v1/admin/security/totp/verify")
        .set(auth(ownerToken))
        .send({
          code: totp(winner.setup.body.secret as string),
          setupToken: winner.setup.body.setupToken,
        })
        .expect(409);
      expect(replay.body.code).toBe("setup_stale");
    });

    it("refuses a ticket issued before the factor became active", async () => {
      // Start from a disabled factor, then issue two tickets against it.
      await prisma.adminUser.update({
        where: { id: ownerId },
        data: { totpEnabled: false, totpSecretEnc: null },
      });
      const first = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({})
        .expect(201);
      const stale = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({})
        .expect(201);

      const activated = await server()
        .post("/api/v1/admin/security/totp/verify")
        .set(auth(ownerToken))
        .send({
          code: totp(first.body.secret as string),
          setupToken: first.body.setupToken,
        })
        .expect(201);
      expect(activated.body.replaced).toBe(false);

      const refused = await server()
        .post("/api/v1/admin/security/totp/verify")
        .set(auth(ownerToken))
        .send({
          code: totp(stale.body.secret as string),
          setupToken: stale.body.setupToken,
        })
        .expect(409);
      expect(refused.body.code).toBe("setup_stale");

      // The setup ticket is mandatory; the old silent legacy path is gone.
      await server()
        .post("/api/v1/admin/security/totp/verify")
        .set(auth(ownerToken))
        .send({ code: "123456" })
        .expect(400);
    });

    it("rolls the secret back when the audit write fails", async () => {
      const staged = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({ password: MASTER_PASSWORD })
        .expect(201);
      const before = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      // Force the audit insert to fail at the database, so the assertion is
      // about the real transaction boundary rather than a Prisma mock. Drop a
      // trigger left by a killed run first so the suite can be re-entered.
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS janosik_failing_audit ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS janosik_test_failing_audit()",
      );
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION janosik_test_failing_audit() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit unavailable';
        END;
        $$ LANGUAGE plpgsql;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER janosik_failing_audit
        BEFORE INSERT ON "AdminAuditLog"
        FOR EACH ROW EXECUTE FUNCTION janosik_test_failing_audit();
      `);
      try {
        await server()
          .post("/api/v1/admin/security/totp/verify")
          .set(auth(ownerToken))
          .send({
            code: totp(staged.body.secret as string),
            setupToken: staged.body.setupToken,
          })
          .expect(500);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS janosik_failing_audit ON "AdminAuditLog"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS janosik_test_failing_audit()",
        );
      }
      const after = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(after.totpSecretEnc).toBe(before.totpSecretEnc);
    });
  });
});
