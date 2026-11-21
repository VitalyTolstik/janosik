import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "counts-master@example.com";
const ADMIN_PASSWORD = "counts master password";

/**
 * TASK-181.7 — the columns and labels lists count only the cards on the page
 * and only live cards. A regression to a global count, zero, or deleted rows
 * would pass the old `_count`-only suites; this fixture pins all three cases.
 */
describe("Admin list card counts (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const server = () => request(app.getHttpServer());
  const get = (path: string) =>
    server()
      .get(`/api/v1/admin/entities/${path}`)
      .set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const owner = await prisma.adminUser.create({
      data: {
        id: "counts-owner",
        email: ADMIN_EMAIL,
        displayName: "Counts master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    adminToken = (
      await server()
        .post("/api/v1/admin/auth/login")
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken;
    expect(owner.role).toBe("OWNER");

    await prisma.user.create({
      data: {
        id: "counts-user",
        email: "counts-user@example.com",
        passwordHash: "unused",
      },
    });

    await prisma.board.createMany({
      data: [
        { id: "counts-board", title: "Counts board" },
        { id: "counts-other-board", title: "Other counts board" },
      ],
    });

    await prisma.column.createMany({
      data: [
        {
          id: "counts-col-live",
          boardId: "counts-board",
          title: "Live",
          position: 0,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 3)),
        },
        {
          id: "counts-col-empty",
          boardId: "counts-board",
          title: "Empty",
          position: 1,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)),
        },
        {
          id: "counts-col-deleted-only",
          boardId: "counts-board",
          title: "Deleted only",
          position: 2,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
        },
        {
          id: "counts-col-other",
          boardId: "counts-other-board",
          title: "Other",
          position: 0,
        },
      ],
    });

    await prisma.card.createMany({
      data: [
        {
          id: "counts-card-1",
          columnId: "counts-col-live",
          title: "Live one",
          position: 0,
        },
        {
          id: "counts-card-2",
          columnId: "counts-col-live",
          title: "Live two",
          position: 1,
        },
        {
          id: "counts-card-deleted",
          columnId: "counts-col-deleted-only",
          title: "Deleted",
          position: 0,
          deletedAt: new Date(Date.UTC(2026, 0, 2)),
        },
        {
          id: "counts-card-other",
          columnId: "counts-col-other",
          title: "Other board",
          position: 0,
        },
      ],
    });

    await prisma.label.createMany({
      data: [
        {
          id: "counts-label-live",
          boardId: "counts-board",
          name: "Live",
          color: "green",
          position: 0,
        },
        {
          id: "counts-label-empty",
          boardId: "counts-board",
          name: "Empty",
          color: "blue",
          position: 1,
        },
        {
          id: "counts-label-deleted",
          boardId: "counts-board",
          name: "Deleted",
          color: "red",
          position: 2,
        },
        {
          id: "counts-label-other",
          boardId: "counts-other-board",
          name: "Other",
          color: "green",
          position: 0,
        },
      ],
    });

    await prisma.cardLabel.createMany({
      data: [
        { cardId: "counts-card-1", labelId: "counts-label-live", position: 0 },
        { cardId: "counts-card-2", labelId: "counts-label-live", position: 0 },
        {
          cardId: "counts-card-deleted",
          labelId: "counts-label-deleted",
          position: 0,
        },
        {
          cardId: "counts-card-other",
          labelId: "counts-label-other",
          position: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("counts live cards per column and returns zero for empty/deleted-only", async () => {
    const response = await get("columns?boardId=counts-board&limit=100").expect(
      200,
    );
    expect(response.body.total).toBe(3);
    const counts = Object.fromEntries(
      response.body.items.map((row: { id: string; cardCount: number }) => [
        row.id,
        row.cardCount,
      ]),
    );
    expect(counts).toEqual({
      "counts-col-live": 2,
      "counts-col-empty": 0,
      "counts-col-deleted-only": 0,
    });
  });

  it("counts live cards per label and returns zero for empty/deleted-only", async () => {
    const response = await get("labels?boardId=counts-board&limit=100").expect(
      200,
    );
    expect(response.body.total).toBe(3);
    const counts = Object.fromEntries(
      response.body.items.map((row: { id: string; cardCount: number }) => [
        row.id,
        row.cardCount,
      ]),
    );
    expect(counts).toEqual({
      "counts-label-live": 2,
      "counts-label-empty": 0,
      "counts-label-deleted": 0,
    });
  });

  it("keeps the per-row counts correct across label pages", async () => {
    for (const [offset, id, cardCount] of [
      [0, "counts-label-live", 2],
      [1, "counts-label-empty", 0],
      [2, "counts-label-deleted", 0],
    ] as const) {
      const response = await get(
        `labels?boardId=counts-board&limit=1&offset=${offset}`,
      ).expect(200);
      expect(response.body.total).toBe(3);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ id, cardCount });
    }
  });
});
