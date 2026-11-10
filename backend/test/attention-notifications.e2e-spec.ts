import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ApprovalRequestDto,
  AttentionNotificationDto,
  AttentionNotificationPage,
  CommentDto,
  CreateUserTokenResponse,
  NotificationSettingsDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { CommsSchedulerService } from "@/ops/comms-scheduler.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "attention-owner@example.com";
const RU_ADMIN_EMAIL = "attention-ru-admin@example.com";
const MEMBER_EMAIL = "attention-member@example.com";
const OUTSIDER_EMAIL = "attention-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.9 — attention inbox, deduplicated e-mail fan-out, digest v2.
 *
 * One board with an EN owner/admin, a RU admin and a non-admin member pins the
 * audience and localization contract; the suite then exercises decision,
 * lazy expiry, claim expiry, blocker/handoff, quota, opt-out and the
 * session-only inbox surface.
 */
describe("Attention notifications (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let ownerSession: string;
  let ruAdminSession: string;
  let outsiderSession: string;
  let ownerId: string;
  let ruAdminId: string;
  let memberId: string;
  let memberSession: string;
  let boardId: string;
  let agentToken: string;

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

    const owner = await register(OWNER_EMAIL, "Owner");
    ownerSession = owner.token;
    ownerId = owner.id;
    const ruAdmin = await register(RU_ADMIN_EMAIL, "Руководитель");
    ruAdminSession = ruAdmin.token;
    ruAdminId = ruAdmin.id;
    const member = await register(MEMBER_EMAIL, "Member");
    memberId = member.id;
    memberSession = member.token;
    outsiderSession = (await register(OUTSIDER_EMAIL, "Outsider")).token;

    await server()
      .patch("/api/v1/users/me")
      .set(auth(ruAdminSession))
      .send({ locale: "ru" })
      .expect(200);

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(ownerSession))
      .send({ title: "Attention board" })
      .expect(201)
      .then((res) => res.body.id as string);

    await invite(RU_ADMIN_EMAIL, "ADMIN", ruAdminSession);
    await invite(MEMBER_EMAIL, "MEMBER", member.token);
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });

    agentToken = (await createToken("owner-agent")).token;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const response = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return {
      token: response.body.accessToken as string,
      id: response.body.user.id as string,
    };
  }

  async function invite(
    email: string,
    role: "ADMIN" | "MEMBER",
    inviteeSession: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerSession))
      .send({ email, role })
      .expect(201);
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(inviteeSession))
      .expect(200)
      .then(
        (res) =>
          (res.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === boardId,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(inviteeSession))
      .expect(200);
  }

  async function createToken(
    name: string,
    login: string = ownerSession,
  ): Promise<CreateUserTokenResponse> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(login))
      .send({ name, expiresAt: null, scopePreset: "worker", trustedCi: false })
      .expect(201)
      .then((res) => res.body as CreateUserTokenResponse);
  }

  async function command(
    action: Record<string, unknown>,
    token: string = ownerSession,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function createCard(title: string): Promise<string> {
    const cardId = randomUUID();
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-1",
      title,
    });
    return cardId;
  }

  function deletePlan(cardId: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      boardId,
      commands: [
        {
          commandId: randomUUID(),
          action: { type: "DELETE_CARD", cardId },
        },
      ],
    };
  }

  function createApproval(
    cardId: string,
    token: string = agentToken,
    ttlMinutes = 30,
    plan: Record<string, unknown> = deletePlan(cardId),
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals`)
      .set(auth(token))
      .send({
        kind: "destructive",
        cardId,
        ttlMinutes,
        plan,
      });
  }

  function decide(
    approvalId: string,
    planHash: string,
    decision: "approve" | "reject" = "approve",
    session: string = ruAdminSession,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals/${approvalId}/decision`)
      .set(auth(session))
      .send({ decision, planHash });
  }

  /** Poll the DB instead of assuming the fire-and-forget fan-out is done. */
  async function waitFor<T>(
    read: () => Promise<T | null>,
    timeoutMs = 5_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await read();
      if (value !== null) return value;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("attention e2e: timed out waiting for a row");
  }

  async function waitForMail(to: string, contains?: string) {
    return waitFor(async () => {
      const mail = mailer.outbox.find(
        (row) =>
          row.to === to &&
          (contains === undefined || row.subject.includes(contains)),
      );
      return mail ?? null;
    });
  }

  async function notificationsFor(
    type: string,
    board: string | null = boardId,
  ): Promise<AttentionNotificationDto[]> {
    return waitFor(async () => {
      const rows = await prisma.attentionNotification.findMany({
        where: { type, boardId: board },
        orderBy: { createdAt: "asc" },
      });
      return rows.length > 0
        ? rows.map((row) => ({
            id: row.id,
            type: row.type as AttentionNotificationDto["type"],
            boardId: row.boardId,
            title: row.title,
            body: row.body,
            data: row.data as Record<string, unknown> | null,
            readAt: row.readAt?.getTime() ?? null,
            createdAt: row.createdAt.getTime(),
          }))
        : null;
    });
  }

  it("notifies board ADMINs (EN and RU), never a token or a non-admin member", async () => {
    const cardId = await createCard("Approval requested");
    mailer.outbox.length = 0;
    const plan = deletePlan(cardId);

    const created = await createApproval(cardId, agentToken, 30, plan).expect(
      201,
    );
    const approval = created.body as ApprovalRequestDto;

    const rows = await notificationsFor("approval.requested");
    expect(
      new Set(
        rows.map((row) => (row.data as { approvalId: string }).approvalId),
      ),
    ).toEqual(new Set([approval.id]));
    const recipients = await prisma.attentionNotification.findMany({
      where: { type: "approval.requested", boardId },
      select: { userId: true },
    });
    expect(new Set(recipients.map((row) => row.userId))).toEqual(
      new Set([ownerId, ruAdminId]),
    );
    expect(recipients.some((row) => row.userId === memberId)).toBe(false);

    await waitForMail(OWNER_EMAIL);
    await waitForMail(RU_ADMIN_EMAIL);
    const ruMail = mailer.outbox.find((row) => row.to === RU_ADMIN_EMAIL)!;
    expect(ruMail.subject.toLowerCase()).toContain("требуется подтверждение");
    expect(mailer.outbox.some((row) => row.to === MEMBER_EMAIL)).toBe(false);
    expect(mailer.outbox.some((row) => row.to === agentToken)).toBe(false);

    // The same token + plan is the same request: no second row, no letter.
    const mailCount = mailer.outbox.length;
    const repeated = await createApproval(cardId, agentToken, 30, plan).expect(
      201,
    );
    expect((repeated.body as ApprovalRequestDto).id).toBe(approval.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      await prisma.attentionNotification.count({
        where: { type: "approval.requested", boardId },
      }),
    ).toBe(2);
    expect(mailer.outbox.length).toBe(mailCount);
  });

  it("notifies the requester and the decision actor, in their own languages", async () => {
    const cardId = await createCard("Approval decided");
    const created = await createApproval(cardId).expect(201);
    const approval = created.body as ApprovalRequestDto;
    await waitForMail(OWNER_EMAIL, "approval needed");
    await waitForMail(RU_ADMIN_EMAIL, "требуется подтверждение");
    mailer.outbox.length = 0;

    await decide(approval.id, approval.planHash).expect(200);

    const rows = await notificationsFor("approval.decided");
    expect(rows).toHaveLength(2);
    const recipients = await prisma.attentionNotification.findMany({
      where: { type: "approval.decided", boardId },
      select: { userId: true },
    });
    expect(new Set(recipients.map((row) => row.userId))).toEqual(
      new Set([ownerId, ruAdminId]),
    );
    const en = await waitForMail(OWNER_EMAIL, "approval approved");
    expect(en.subject).toContain("approval approved");
    const ru = await waitForMail(RU_ADMIN_EMAIL, "запрос одобрен");
    expect(ru.subject.toLowerCase()).toContain("запрос одобрен");

    // A repeated approve is idempotent and must not notify again.
    await decide(approval.id, approval.planHash).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      await prisma.attentionNotification.count({
        where: { type: "approval.decided", boardId },
      }),
    ).toBe(2);
  });

  it("raises approval.expired exactly once when the lazy sweep expires a request", async () => {
    const cardId = await createCard("Approval expiry");
    const created = await createApproval(cardId).expect(201);
    const approval = created.body as ApprovalRequestDto;
    await waitForMail(RU_ADMIN_EMAIL);
    mailer.outbox.length = 0;
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await server()
      .get(`/api/v1/boards/${boardId}/approvals/${approval.id}`)
      .set(auth(ownerSession))
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardId}/approvals/${approval.id}`)
      .set(auth(ownerSession))
      .expect(200);

    const rows = await notificationsFor("approval.expired");
    expect(rows).toHaveLength(1);
    expect((rows[0]!.data as { approvalId: string }).approvalId).toBe(
      approval.id,
    );
    await waitForMail(OWNER_EMAIL);
  });

  it("clears a lapsed claim and notifies ADMINs and the claimant once", async () => {
    const cardId = await createCard("Claim expiry");
    await command(
      {
        type: "CLAIM_CARD",
        cardId,
        claimedBy: ownerId,
        leaseUntil: Date.now() + 60_000,
      },
      agentToken,
    );
    const claimed = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    expect(claimed.claimedByTokenId).not.toBeNull();
    await prisma.card.update({
      where: { id: cardId },
      data: { leaseUntil: new Date(Date.now() - 1_000) },
    });
    mailer.outbox.length = 0;

    const maintenance = app.get(MaintenanceService);
    expect(await maintenance.sweepClaims()).toBe(1);

    const rows = await notificationsFor("claim.expired");
    const recipients = await prisma.attentionNotification.findMany({
      where: { type: "claim.expired" },
      select: { userId: true },
    });
    expect(new Set(recipients.map((row) => row.userId))).toEqual(
      new Set([ownerId, ruAdminId]),
    );
    expect(mailer.outbox.some((row) => row.to === MEMBER_EMAIL)).toBe(false);
    await waitForMail(OWNER_EMAIL);

    const cleared = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    expect(cleared.claimedBy).toBeNull();
    expect(cleared.leaseUntil).toBeNull();
    expect(await maintenance.sweepClaims()).toBe(0);
    expect(
      await prisma.attentionNotification.count({
        where: { type: "claim.expired" },
      }),
    ).toBe(rows.length);
  });

  it("maps agent blocker/handoff comments to attention, but ignores human notes", async () => {
    const cardId = await createCard("Blocked card");
    mailer.outbox.length = 0;

    const blocker = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(agentToken))
      .send({ text: "Waiting for credentials", kind: "blocker" })
      .expect(201);
    expect((blocker.body as CommentDto).actorType).toBe("agent");
    await notificationsFor("agent.blocked");
    await waitForMail(RU_ADMIN_EMAIL);

    const handoff = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(agentToken))
      .send({ text: "Handing to a human", kind: "handoff" })
      .expect(201);
    expect((handoff.body as CommentDto).actorType).toBe("agent");
    await notificationsFor("agent.needs_human");

    // A human blocker note is normal conversation, not an agent attention.
    await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(ownerSession))
      .send({ text: "I am blocked too", kind: "blocker" })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      await prisma.attentionNotification.count({
        where: { type: "agent.blocked" },
      }),
    ).toBe(2);
  });

  it("records a quota warning when the operator board cap refuses a create", async () => {
    const previous = process.env.MAX_BOARDS_PER_USER;
    process.env.MAX_BOARDS_PER_USER = "1";
    try {
      mailer.outbox.length = 0;
      const refused = await server()
        .post("/api/v1/boards")
        .set(auth(ownerSession))
        .send({ title: "Over quota" });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("limit_exceeded");

      const rows = await notificationsFor("quota.exceeded", null);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.boardId).toBeNull();
      expect(rows[0]!.data).toMatchObject({
        resource: "board",
        limit: 1,
        current: 1,
      });
      await waitForMail(OWNER_EMAIL);

      await server()
        .post("/api/v1/boards")
        .set(auth(ownerSession))
        .send({ title: "Over quota again" })
        .expect(409);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        await prisma.attentionNotification.count({
          where: { type: "quota.exceeded", userId: ownerId },
        }),
      ).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.MAX_BOARDS_PER_USER;
      else process.env.MAX_BOARDS_PER_USER = previous;
    }
  });

  it("serves a session-only inbox with board scoping, read state and settings", async () => {
    // Non-admin outsider cannot filter by a board they do not belong to.
    await server()
      .get(`/api/v1/users/me/notifications?boardId=${boardId}`)
      .set(auth(outsiderSession))
      .expect(403);

    // An API key never reads the human inbox.
    await server()
      .get("/api/v1/users/me/notifications")
      .set(auth(agentToken))
      .expect(403);

    const all = await server()
      .get("/api/v1/users/me/notifications")
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationPage);
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.unreadCount).toBeGreaterThan(0);

    const scoped = await server()
      .get(`/api/v1/users/me/notifications?boardId=${boardId}`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationPage);
    expect(scoped.items.every((row) => row.boardId === boardId)).toBe(true);

    // A filter for another board the owner belongs to must not return this
    // board's events.
    const secondBoard = await server()
      .post("/api/v1/boards")
      .set(auth(ownerSession))
      .send({ title: "Other attention board" })
      .expect(201)
      .then((res) => res.body.id as string);
    const other = await server()
      .get(`/api/v1/users/me/notifications?boardId=${secondBoard}`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationPage);
    expect(other.items).toHaveLength(0);

    const first = scoped.items[0]!;
    const read = await server()
      .post(`/api/v1/users/me/notifications/${first.id}/read`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationDto);
    expect(read.readAt).toEqual(expect.any(Number));

    // Another member cannot read or acknowledge this user's row.
    await server()
      .post(`/api/v1/users/me/notifications/${first.id}/read`)
      .set(auth(memberSession))
      .expect(404);

    const afterRead = await server()
      .get("/api/v1/users/me/notifications?unreadOnly=true")
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationPage);
    expect(afterRead.items.some((row) => row.id === first.id)).toBe(false);

    const settings = await server()
      .get("/api/v1/users/me/notification-settings")
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as NotificationSettingsDto);
    expect(settings).toEqual({ notifyDigest: true, notifyAttention: true });

    const patched = await server()
      .patch("/api/v1/users/me/notification-settings")
      .set(auth(ownerSession))
      .send({ notifyAttention: false })
      .expect(200)
      .then((res) => res.body as NotificationSettingsDto);
    expect(patched.notifyAttention).toBe(false);

    // Opt-out: the in-app row is still written, the letter is not.
    const cardId = await createCard("Opted out approval");
    mailer.outbox.length = 0;
    await createApproval(cardId).expect(201);
    await notificationsFor("approval.requested");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailer.outbox.some((row) => row.to === OWNER_EMAIL)).toBe(false);

    const readAll = await server()
      .post("/api/v1/users/me/notifications/read-all")
      .set(auth(ownerSession))
      .send({ boardId })
      .expect(200)
      .then((res) => res.body as { updated: number });
    expect(readAll.updated).toBeGreaterThan(0);
    const unread = await server()
      .get(`/api/v1/users/me/notifications?boardId=${boardId}&unreadOnly=true`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as AttentionNotificationPage);
    expect(unread.items).toHaveLength(0);

    await server()
      .patch("/api/v1/users/me/notification-settings")
      .set(auth(ownerSession))
      .send({ notifyAttention: true })
      .expect(200);
  });

  it("includes attention categories in digest v2 and does not repeat them", async () => {
    const ops = app.get(CommsSchedulerService);
    await prisma.opsSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", digestIntervalHours: 24 },
      update: { digestIntervalHours: 24 },
    });
    // The ops singleton is cached for 15 s; the panel invalidates on write.
    app.get(OpsSettingsService).invalidate();
    // Ensure there is undigested attention for the owner (the quota row is
    // account-level and intentionally not part of a board digest).
    if (
      (await prisma.attentionNotification.count({
        where: { userId: ownerId, boardId, digestedAt: null },
      })) === 0
    ) {
      const cardId = await createCard("Digest attention");
      await createApproval(cardId).expect(201);
      await notificationsFor("approval.requested");
    }
    await prisma.user.update({
      where: { id: ownerId },
      data: { notifyDigest: true, notifyAttention: true },
    });
    mailer.outbox.length = 0;

    await ops.run("digest");

    const digest = await waitForMail(OWNER_EMAIL, "Attention board");
    expect(digest.text).toContain("Needs attention:");
    expect(digest.text).toContain("approvals requested");
    expect(
      await prisma.attentionNotification.count({
        where: { userId: ownerId, boardId, digestedAt: null },
      }),
    ).toBe(0);

    mailer.outbox.length = 0;
    await ops.run("digest");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = mailer.outbox.find((row) => row.to === OWNER_EMAIL);
    if (second !== undefined) {
      expect(second.text).not.toContain("Needs attention:");
    }
  });
});
