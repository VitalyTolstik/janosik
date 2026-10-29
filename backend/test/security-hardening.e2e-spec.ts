import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardEnvelope } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const ADMIN_EMAIL = "security-admin@example.com";
const VIEWER_EMAIL = "security-viewer@example.com";
const OUTSIDER_EMAIL = "security-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-147 security hardening (B4/B5): an expired VIEWER must not keep reading
 * a board from a listing, and an imported (or restored) card must not keep an
 * assignee who is not a member of the target board.
 *
 * The expiry is written straight to the DB, without a prior board request:
 * `MembershipGuard` would otherwise lazily delete the row and mask the leak.
 */
describe("Security hardening (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let adminId: string;
  let outsiderId: string;

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
    await wipe(prisma);

    adminToken = await register(ADMIN_EMAIL, "Admin");
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");
    adminId = await me(adminToken);
    outsiderId = await me(outsiderToken);
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function me(token: string): Promise<string> {
    const res = await server()
      .get("/api/v1/auth/me")
      .set(auth(token))
      .expect(200);
    return res.body.id as string;
  }

  it("hides an expired VIEWER from the board list and the member list", async () => {
    const board = (
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Expiry board" })
        .expect(201)
    ).body as Board;

    await server()
      .post(`/api/v1/boards/${board.id}/members`)
      .set(auth(adminToken))
      .send({ email: VIEWER_EMAIL, role: "VIEWER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(viewerToken))
      .expect(200);
    const invitation = invitations.body.find(
      (row: { boardId: string }) => row.boardId === board.id,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(viewerToken))
      .expect(200);

    const viewerId = await me(viewerToken);
    // The budget lapses in the past — no request has touched the board since,
    // so the stale row is still there for the queries to trip over.
    await prisma.boardMember.update({
      where: { boardId_userId: { boardId: board.id, userId: viewerId } },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const listed = await server()
      .get("/api/v1/boards")
      .set(auth(viewerToken))
      .expect(200);
    expect(listed.body.map((b: { id: string }) => b.id)).not.toContain(
      board.id,
    );

    const members = await server()
      .get(`/api/v1/boards/${board.id}/members`)
      .set(auth(adminToken))
      .expect(200);
    expect(members.body.map((m: { email: string }) => m.email)).not.toContain(
      VIEWER_EMAIL,
    );
  });

  it("drops a non-member assignee on import but keeps the importer", async () => {
    const envelope: BoardEnvelope = {
      app: "janosik",
      schemaVersion: 1,
      exportedAt: Date.now(),
      boards: [
        {
          id: "src-board",
          title: "Imported assignments",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          labels: [],
          columns: [
            {
              id: "col-1",
              title: "Todo",
              cardIds: ["card-outsider", "card-admin"],
              createdAt: 1_700_000_000_000,
            },
          ],
          cards: {
            "card-outsider": {
              id: "card-outsider",
              title: "Assigned to a stranger",
              assigneeId: outsiderId,
              labelIds: [],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
            },
            "card-admin": {
              id: "card-admin",
              title: "Assigned to the importer",
              assigneeId: adminId,
              labelIds: [],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
            },
          },
        } as Board,
      ],
    };

    const imported = (
      await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send(envelope)
        .expect(201)
    ).body as Board[];

    const cards = Object.values(imported[0].cards);
    const stranger = cards.find((c) => c.title === "Assigned to a stranger");
    const importer = cards.find((c) => c.title === "Assigned to the importer");
    expect(stranger?.assigneeId).toBeUndefined();
    expect(importer?.assigneeId).toBe(adminId);
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
    await db.boardShare.deleteMany();
    await db.boardMember.deleteMany();
    await db.reminderSent.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.apiToken.deleteMany();
    await db.dataExport.deleteMany();
    await db.user.deleteMany();
  }
});
