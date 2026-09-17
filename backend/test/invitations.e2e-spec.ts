import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "invites-owner@example.com";
const INVITEE_EMAIL = "invites-invitee@example.com";
const OTHER_EMAIL = "invites-other@example.com";
const PASSWORD = "correct horse battery";

/**
 * Opt-in invitations (TASK-35 addendum).
 *
 * An invite creates a pending `BoardMember` row that grants NO access: the
 * board is invisible and every board route answers 403 until the invitee
 * accepts from `GET /invitations`. Declining drops the row for good.
 */
describe("Invitations API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let inviteeToken: string;
  let otherToken: string;

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
    inviteeToken = await register(INVITEE_EMAIL, "Invitee");
    otherToken = await register(OTHER_EMAIL, "Other");
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

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function invite(
    boardId: string,
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
  ): Promise<{ id: string }> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email, role })
      .expect(201);
    return { id: res.body.userId as string };
  }

  async function invitationsFor(token: string, boardId: string) {
    return (await listInvitations(token)).filter(
      (row) => row.boardId === boardId,
    );
  }

  async function listInvitations(token: string) {
    const res = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    return res.body as Array<{
      id: string;
      boardId: string;
      boardTitle: string;
      role: string;
      invitedByEmail: string | null;
    }>;
  }

  it("shows the invitation with board and inviter, but grants no access", async () => {
    const boardId = await createBoard("Invite board");
    await invite(boardId, INVITEE_EMAIL);

    // Not a member yet: invisible in the board list, 403 on the aggregate.
    const boards = await server()
      .get("/api/v1/boards")
      .set(auth(inviteeToken))
      .expect(200);
    expect(boards.body).toEqual([]);
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(inviteeToken))
      .expect(403);

    const invitations = await listInvitations(inviteeToken);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      boardId,
      boardTitle: "Invite board",
      role: "MEMBER",
      invitedByEmail: OWNER_EMAIL,
    });
  });

  it("accepting turns the invitation into membership", async () => {
    const boardId = await createBoard("Accept board");
    await invite(boardId, INVITEE_EMAIL);
    const [invitation] = await listInvitations(inviteeToken);

    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(inviteeToken))
      .expect(200);

    const boards = await server()
      .get("/api/v1/boards")
      .set(auth(inviteeToken))
      .expect(200);
    expect(boards.body.map((b: { id: string }) => b.id)).toEqual([boardId]);
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(inviteeToken))
      .expect(200);
    expect(await invitationsFor(inviteeToken, boardId)).toHaveLength(0);

    // The invitee now shows up as a member and the feed tells the story.
    const members = await server()
      .get(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .expect(200);
    expect(members.body.map((m: { email: string }) => m.email)).toContain(
      INVITEE_EMAIL,
    );
    const activity = await server()
      .get(`/api/v1/boards/${boardId}/activity`)
      .set(auth(ownerToken))
      .expect(200);
    expect(
      activity.body.items.map((item: { type: string }) => item.type),
    ).toContain("member_invite_accepted");
  });

  it("declining drops the invitation and never grants access", async () => {
    const boardId = await createBoard("Decline board");
    await invite(boardId, INVITEE_EMAIL);
    const [invitation] = await listInvitations(inviteeToken);

    await server()
      .post(`/api/v1/invitations/${invitation.id}/decline`)
      .set(auth(inviteeToken))
      .expect(200);

    expect(await invitationsFor(inviteeToken, boardId)).toHaveLength(0);
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(inviteeToken))
      .expect(403);
    // The owner can invite again after a decline.
    await invite(boardId, INVITEE_EMAIL);
  });

  it("404s someone else's invitation and an unknown id", async () => {
    const boardId = await createBoard("Guarded board");
    await invite(boardId, INVITEE_EMAIL);
    const [invitation] = await listInvitations(inviteeToken);

    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(otherToken))
      .expect(404);
    await server()
      .post("/api/v1/invitations/does-not-exist/accept")
      .set(auth(inviteeToken))
      .expect(404);

    // An admin can still cancel a pending invitation by removing the row.
    const pending = await prisma.boardMember.findFirst({
      where: { boardId, acceptedAt: null },
    });
    await server()
      .delete(`/api/v1/boards/${boardId}/members/${pending?.userId}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(await invitationsFor(inviteeToken, boardId)).toHaveLength(0);
  });

  it("409s an expired invitation and cleans it up", async () => {
    const boardId = await createBoard("Expired board");
    const future = new Date(Date.now() - 1000).toISOString();
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email: INVITEE_EMAIL, role: "VIEWER", expiresAt: future })
      .expect(201);
    const [invitation] = await listInvitations(inviteeToken);

    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(inviteeToken))
      .expect(409);
    expect(await invitationsFor(inviteeToken, boardId)).toHaveLength(0);
  });

  it("409s a duplicate invite while one is pending", async () => {
    const boardId = await createBoard("Duplicate board");
    await invite(boardId, INVITEE_EMAIL);
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email: INVITEE_EMAIL, role: "MEMBER" })
      .expect(409);
  });

  it("ignores pending ADMINs for the last-ADMIN guard", async () => {
    const boardId = await createBoard("Last admin board");
    await invite(boardId, INVITEE_EMAIL, "ADMIN");
    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(ownerToken))
      .expect(200);

    // The owner is still the only accepted ADMIN — demoting them must 409
    // even though a pending ADMIN invitation exists.
    await server()
      .patch(`/api/v1/boards/${boardId}/members/${me.body.id}`)
      .set(auth(ownerToken))
      .send({ role: "MEMBER" })
      .expect(409);
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.activity.deleteMany();
    await db.boardMember.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
