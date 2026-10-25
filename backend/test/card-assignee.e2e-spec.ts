import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "assignee-owner@example.com";
const OUTSIDER_EMAIL = "assignee-outsider@example.com";
const INVITEE_EMAIL = "assignee-invitee@example.com";
const MEMBER_EMAIL = "assignee-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * The assignee gate (TASK-49): a `SET_CARD_ASSIGN` command may only name a
 * user who is an active board member — a row that has accepted its
 * invitation and is not an expired VIEWER. Unassigning (`null`) needs no
 * member, and inverse (undo) commands are exempt so a historical state can
 * be restored even when the member has since left.
 */
describe("Card assignee gate (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let ownerId: string;
  let memberToken: string;
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
    ownerId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: OWNER_EMAIL },
        select: { id: true },
      })
    ).id;
    await register(OUTSIDER_EMAIL, "Outsider");
    await register(INVITEE_EMAIL, "Invitee");
    memberToken = await register(MEMBER_EMAIL, "Member");

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Assignee board" })
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

    // The invitee is invited (a pending boardMember row exists) but never
    // accepts; the member accepts — the gate tells them apart.
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email: INVITEE_EMAIL, role: "VIEWER" })
      .expect(201);
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
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function userIdOf(email: string): Promise<string> {
    return prisma.user
      .findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
      .then((row) => row.id);
  }

  async function command(action: Record<string, unknown>): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  function assign(assigneeId: string | null, token = ownerToken): request.Test {
    const action = {
      type: "SET_CARD_ASSIGN",
      cardId: "card-1",
      assigneeId,
      boardId,
      at: Date.now(),
    } as unknown as BoardAction;
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action });
  }

  async function assignedCard(): Promise<Board["cards"][string]> {
    const board = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerToken))
      .expect(200)
      .then((res) => res.body as Board);
    return board.cards["card-1"];
  }

  it("assigns an accepted member and unassigns back", async () => {
    await assign(await userIdOf(MEMBER_EMAIL)).expect(200);
    const card = await assignedCard();
    expect(card.assigneeId).toEqual(await userIdOf(MEMBER_EMAIL));

    await assign(null).expect(200);
    const cleared = await assignedCard();
    expect(cleared.assigneeId).toBeUndefined();
  });

  it("refuses a user who is not a board member at all", async () => {
    const res = await assign(await userIdOf(OUTSIDER_EMAIL)).expect(400);
    expect(res.body).toMatchObject({ field: "action.assigneeId" });
    const card = await assignedCard();
    expect(card.assigneeId).toBeUndefined();
  });

  it("refuses a pending (never-accepted) invitee", async () => {
    const res = await assign(await userIdOf(INVITEE_EMAIL)).expect(400);
    expect(res.body).toMatchObject({ field: "action.assigneeId" });
  });

  it("lets a MEMBER role assign a colleague", async () => {
    await assign(await userIdOf(OWNER_EMAIL), memberToken).expect(200);
    const card = await assignedCard();
    expect(card.assigneeId).toEqual(ownerId);
    await assign(null, memberToken).expect(200);
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
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
