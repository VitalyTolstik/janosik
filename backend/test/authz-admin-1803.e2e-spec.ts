import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { decryptSecret, encryptSecret } from "@/mailer/secret-box";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "owner-1803@example.com";
const OPERATOR_EMAIL = "operator-1803@example.com";
const MASTER_PASSWORD = "master correct horse battery";
const VICTIM_PASSWORD = "victim correct horse battery";
const VICTIM_EMAIL = "victim-1803@example.com";

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
    it("refuses a silent replacement and audits a proven one", async () => {
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

      const replaced = await server()
        .post("/api/v1/admin/security/totp")
        .set(auth(ownerToken))
        .send({ password: MASTER_PASSWORD })
        .expect(201);

      expect(replaced.body.secret).toEqual(expect.any(String));
      const row = await prisma.adminUser.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(decryptSecret(row.totpSecretEnc!)).not.toBe(oldSecret);
      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "security.totp_replaced", targetId: ownerId },
      });
      expect(audit).not.toBeNull();
    });
  });
});
