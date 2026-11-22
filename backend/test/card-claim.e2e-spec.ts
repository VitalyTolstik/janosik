import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "claim-owner@example.com";
const MEMBER_EMAIL = "claim-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * The claim gate (TASK-157): a `CLAIM_CARD` may not take a lease another
 * member still holds — the atomic "do not steal" rule that lets a swarm
 * parallelise. A lapsed lease (`leaseUntil` in the past) is free, and a
 * release (`claimedBy: null`) clears the fields. TASK-177.4 adds the two
 * sanctioned releases: the human owner and a board ADMIN.
 */
describe("Card claim gate (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let ownerId: string;
  let memberToken: string;
  let memberId: string;
  let memberPatA: string;
  let memberPatB: string;
  let boardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    ownerToken = await register(OWNER_EMAIL, "Owner");
    ownerId = await userIdOf(OWNER_EMAIL);
    memberToken = await register(MEMBER_EMAIL, "Member");
    memberId = await userIdOf(MEMBER_EMAIL);

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Claim board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-1",
      columnId: "col-1",
      title: "First",
    });

    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email: MEMBER_EMAIL, role: "MEMBER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(memberToken))
      .expect(200);
    const invitation = invitations.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(memberToken))
      .expect(200);

    memberPatA = await createPat("claim-pat-a");
    memberPatB = await createPat("claim-pat-b");
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function createPat(name: string): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(memberToken))
      .send({ name, expiresAt: null, scopePreset: "worker" })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function userIdOf(email: string): Promise<string> {
    return prisma.user
      .findUniqueOrThrow({ where: { email }, select: { id: true } })
      .then((row) => row.id);
  }

  async function command(
    action: Record<string, unknown>,
    token = ownerToken,
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

  function claim(
    claimedBy: string | null,
    leaseUntil: number | null,
    token = ownerToken,
  ): request.Test {
    const action = {
      type: "CLAIM_CARD",
      cardId: "card-1",
      claimedBy,
      leaseUntil,
      boardId,
      at: Date.now(),
    } as unknown as BoardAction;
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action });
  }

  async function card(): Promise<Board["cards"][string]> {
    const board = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerToken))
      .expect(200)
      .then((res) => res.body as Board);
    return board.cards["card-1"];
  }

  it("lets a member claim a free card", async () => {
    await claim(memberId, Date.now() + 900_000, memberToken).expect(200);
    const current = await card();
    expect(current.claimedBy).toBe(memberId);
    expect(current.leaseUntil).toBeGreaterThan(Date.now());
  });

  it("refuses to steal a live lease held by another member", async () => {
    const res = await claim(ownerId, Date.now() + 900_000).expect(400);
    expect(res.body.message).toMatch(/claimed by another member/i);
    expect((await card()).claimedBy).toBe(memberId);
  });

  it("takes over once the lease has lapsed", async () => {
    await command(
      {
        type: "CLAIM_CARD",
        cardId: "card-1",
        claimedBy: memberId,
        leaseUntil: Date.now() - 1_000,
      },
      memberToken,
    );
    await claim(ownerId, Date.now() + 900_000).expect(200);
    expect((await card()).claimedBy).toBe(ownerId);
  });

  it("releases the claim", async () => {
    await claim(null, null).expect(200);
    const current = await card();
    expect(current.claimedBy).toBeUndefined();
    expect(current.leaseUntil).toBeUndefined();
  });

  it("refuses a release by another member and lets the owner release their own claim", async () => {
    await claim(ownerId, Date.now() + 900_000).expect(200);
    expect((await card()).claimedBy).toBe(ownerId);

    // A plain MEMBER is neither the holder nor an ADMIN.
    await claim(null, null, memberToken).expect(400);
    expect((await card()).claimedBy).toBe(ownerId);

    // The human owner (also the board ADMIN) can clear it.
    await claim(null, null).expect(200);
    const current = await card();
    expect(current.claimedBy).toBeUndefined();
    expect(current.leaseUntil).toBeUndefined();
  });

  it("lets a board ADMIN release another member's live claim (TASK-177.4)", async () => {
    await claim(memberId, Date.now() + 900_000, memberPatA).expect(200);

    await claim(null, null).expect(200);
    const board = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerToken))
      .expect(200)
      .then((res) => res.body as Board);
    const current = board.cards["card-1"];
    expect(current.claimedBy).toBeUndefined();
    expect(current.leaseUntil).toBeUndefined();
    // The release is a normal command: the ADMIN is its last actor.
    expect(current.lastActorId).toBe(ownerId);
  });

  it("lets the human owner release a claim held by their own PAT", async () => {
    await claim(memberId, Date.now() + 900_000, memberPatA).expect(200);

    await claim(null, null, memberToken).expect(200);
    const current = await card();
    expect(current.claimedBy).toBeUndefined();
    expect(current.leaseUntil).toBeUndefined();
  });

  it("keeps two PATs of one owner distinct for release (M7)", async () => {
    await claim(memberId, Date.now() + 900_000, memberPatA).expect(200);

    // A second PAT of the same user is still a different holder.
    await claim(null, null, memberPatB).expect(400);
    expect((await card()).claimedBy).toBe(memberId);

    // The token that holds the lease can clear it.
    await claim(null, null, memberPatA).expect(200);
    const current = await card();
    expect(current.claimedBy).toBeUndefined();
    expect(current.leaseUntil).toBeUndefined();
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.commentRevision.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.apiToken.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
