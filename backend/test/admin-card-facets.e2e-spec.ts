import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash } from "argon2";
import request from "supertest";
import type { AdminCardRowDto, AdminPage } from "@janosik/shared";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const DAY = 86_400_000;
const BOARD = "facet-board";
const COLUMN = "facet-column";
const CARD_IDS = [
  "both",
  "just-a",
  "just-b",
  "at-now",
  "archived",
  "deleted",
  "old",
];
const EMAIL = "card-facets-master@example.com";
const PASSWORD = "card facets test password";

describe("Admin cards full facets", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let now: number;
  const api = () => request(app.getHttpServer());
  const authorization = () => `Bearer ${token}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);
    await prisma.adminUser.create({
      data: {
        email: EMAIL,
        role: "OWNER",
        passwordHash: await hash(PASSWORD, { type: argon2id }),
      },
    });
    token = (
      await api()
        .post("/api/v1/admin/auth/login")
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200)
    ).body.accessToken;

    now = Date.now();
    await prisma.user.createMany({
      data: ["user-a", "user-b", "user-c"].map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash: "unused",
      })),
    });
    await prisma.board.create({ data: { id: BOARD, title: "Facet fixture" } });
    await prisma.column.create({
      data: {
        id: COLUMN,
        boardId: BOARD,
        title: "Facet fixture column",
        position: 0,
      },
    });
    await prisma.label.createMany({
      data: ["label-a", "label-b", "label-extra"].map((id, position) => ({
        id,
        boardId: BOARD,
        name: id,
        color: "red",
        position,
      })),
    });
    const daysAgo = [
      0,
      DAY,
      DAY + 1,
      7 * DAY,
      7 * DAY + 1,
      30 * DAY,
      30 * DAY + 1,
    ];
    const dueOffsets = [DAY, -1, DAY + 1, 0, -2, -3, null];
    const priorities = [
      null,
      "medium",
      "high",
      "highest",
      "high",
      "medium",
      "low",
    ];
    const assignees = [
      "user-a",
      "user-b",
      null,
      "user-c",
      null,
      "user-b",
      null,
    ];
    await prisma.card.createMany({
      data: CARD_IDS.map((id, position) => ({
        id,
        position,
        columnId: COLUMN,
        title: [0, 1].includes(position) ? `Canary ${id}` : `Other ${id}`,
        assigneeId: assignees[position],
        priority: priorities[position],
        dueDate:
          dueOffsets[position] === null
            ? null
            : new Date(now + dueOffsets[position]),
        createdAt: new Date(now - daysAgo[position]),
        updatedAt: new Date(now - position),
        archivedAt: ["archived", "deleted"].includes(id) ? new Date(now) : null,
        deletedAt: id === "deleted" ? new Date(now) : null,
        attachmentCount: position < 2 ? 1 : 0,
      })),
    });
    await prisma.cardLabel.createMany({
      data: [
        ...["label-a", "label-b", "label-extra"].map((labelId, position) => ({
          cardId: "both",
          labelId,
          position,
        })),
        { cardId: "just-a", labelId: "label-a", position: 0 },
        { cardId: "just-b", labelId: "label-b", position: 0 },
      ],
    });
    await prisma.attachment.createMany({
      data: [
        { id: "plain", cardId: "both" },
        {
          id: "referenced",
          cardId: "just-a",
          descriptionEmbed: true,
          descriptionDetached: false,
        },
        { id: "inline", cardId: "just-b", isInline: true },
        {
          id: "detached-only",
          cardId: "at-now",
          descriptionEmbed: true,
          descriptionDetached: true,
        },
        {
          id: "detached-mixed",
          cardId: "just-a",
          descriptionEmbed: true,
          descriptionDetached: true,
        },
        { id: "inline-mixed", cardId: "just-a", isInline: true },
        { id: "deleted-file", cardId: "old", deletedAt: new Date(now) },
      ].map((file) => ({
        ...file,
        boardId: BOARD,
        uploadedById: "user-a",
        fileName: `${file.id}.png`,
        storedName: file.id,
        mimeType: "image/png",
        sizeBytes: 12,
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const list = async (route: string, query: string) => {
    const { body } = await api()
      .get(`/api/v1/admin/${route}?boardId=${BOARD}&${query}`)
      .set("Authorization", authorization())
      .expect(200);
    return body as AdminPage<AdminCardRowDto>;
  };

  async function expectBoth(query: string, ids: string[], total = ids.length) {
    for (const route of ["cards", "entities/cards"]) {
      const page = await list(route, query);
      expect(page.total).toBe(total);
      expect(page.items.map(({ id }) => id).sort()).toEqual([...ids].sort());
    }
  }

  it("uses OR across label and assignee values, with explicit all-label matching", async () => {
    await expectBoth("labelId=label-a", ["both", "just-a"]);
    await expectBoth("labelId=label-a&labelId=label-b", [
      "both",
      "just-a",
      "just-b",
    ]);
    await expectBoth("labelId=label-a&labelId=label-b&labelMatch=all", [
      "both",
    ]);
    await expectBoth("labelId=label-a&labelId=label-b&labelMatch=any", [
      "both",
      "just-a",
      "just-b",
    ]);
    await expectBoth("labelId=+label-a+&labelId=label-a&labelMatch=all", [
      "both",
      "just-a",
    ]);
    await expectBoth("labelMatch=all", CARD_IDS);
    await expectBoth("assigneeId=user-a&assigneeId=user-b", [
      "both",
      "just-a",
      "deleted",
    ]);
    await expectBoth("assigneeId=user-a&assigneeId=user-b&unassigned=true", [
      "both",
      "just-a",
      "just-b",
      "archived",
      "deleted",
      "old",
    ]);
    await expectBoth("unassigned=true", ["just-b", "archived", "old"]);
    await expectBoth("unassigned=false", CARD_IDS);
  });

  it("treats null as medium and combines priority, search, labels, assignees and other facets with AND", async () => {
    await expectBoth("priority=medium", ["both", "just-a", "deleted"]);
    await expectBoth("priority=high&priority=medium", [
      "both",
      "just-a",
      "just-b",
      "archived",
      "deleted",
    ]);
    const query = `search=canary&priority=medium&labelId=label-a&labelId=label-b&assigneeId=user-a&assigneeId=user-b&unassigned=true&hasAttachments=true&status=active&from=${now - DAY}`;
    await expectBoth(query, ["both", "just-a"]);
    await expectBoth(`${query}&labelMatch=all`, ["both"]);
    await expectBoth(`${query}&limit=1&offset=1`, ["just-a"], 2);
  });

  it("uses exact due boundaries and preserves status semantics", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    try {
      await expectBoth("due=soon", ["both", "at-now"]);
      await expectBoth("due=overdue", ["just-a", "archived", "deleted"]);
      await expectBoth("due=none", ["old"]);
      await expectBoth("due=overdue&status=active", ["just-a"]);
      await expectBoth("due=overdue&status=archived", ["archived"]);
      await expectBoth("due=overdue&status=deleted", ["deleted"]);
    } finally {
      clock.mockRestore();
    }
  });

  it("includes cards exactly at the 24h, 7d, and 30d createdAt boundaries", async () => {
    for (const [days, count] of [
      [1, 2],
      [7, 4],
      [30, 6],
    ]) {
      const from = now - days * DAY;
      await expectBoth(`from=${from}`, CARD_IDS.slice(0, count));
      await expectBoth(`from=${from}&to=${from}`, [CARD_IDS[count - 1]]);
    }
  });

  it("filters by card-face files and recounts description states during admin delete, bulk delete and restore", async () => {
    await expectBoth("hasAttachments=true", ["both", "just-a"]);
    await expectBoth("hasAttachments=false", [
      "just-b",
      "at-now",
      "archived",
      "deleted",
      "old",
    ]);

    const expectCount = async (expected: number) => {
      const card = await prisma.card.findUniqueOrThrow({
        where: { id: "just-a" },
      });
      expect(card.attachmentCount).toBe(expected);
    };
    const attachment = (id: string) =>
      api()
        .delete(`/api/v1/admin/attachments/${id}`)
        .set("Authorization", authorization())
        .expect(200);
    const bulk = async (action: "delete" | "restore", id: string) => {
      const { body } = await api()
        .post("/api/v1/admin/entities/attachments/bulk")
        .set("Authorization", authorization())
        .send({ action, ids: [id] })
        .expect(201);
      expect(body).toEqual({ affected: 1 });
    };

    await attachment("inline-mixed");
    await expectCount(1);
    await attachment("referenced");
    await expectCount(0);
    await expectBoth("hasAttachments=true", ["both"]);

    await bulk("restore", "referenced");
    await expectCount(1);
    await bulk("delete", "referenced");
    await expectCount(0);
    await bulk("delete", "detached-mixed");
    await bulk("restore", "detached-mixed");
    await expectCount(0);
    await expectBoth("hasAttachments=false", [
      "just-a",
      "just-b",
      "at-now",
      "archived",
      "deleted",
      "old",
    ]);
  });

  it("excludes surviving detached description media from the badge after account deletion", async () => {
    const cardId = "at-now";
    const uploader = await prisma.user.create({
      data: { email: "deleted-uploader@example.com", passwordHash: "unused" },
    });
    const attachment = await prisma.attachment.create({
      data: {
        cardId,
        boardId: BOARD,
        uploadedById: uploader.id,
        fileName: "account-deletion-file.txt",
        storedName: "account-deletion-file",
        mimeType: "text/plain",
        sizeBytes: 12,
      },
    });
    await prisma.card.update({
      where: { id: cardId },
      data: { attachmentCount: 1 },
    });
    await expectBoth(`cardId=${cardId}&hasAttachments=true`, [cardId]);

    await api()
      .delete(`/api/v1/admin/users/${uploader.id}`)
      .set("Authorization", authorization())
      .expect(200);

    expect(
      await prisma.attachment.findUnique({ where: { id: attachment.id } }),
    ).toBeNull();
    expect(
      await prisma.attachment.findUnique({ where: { id: "detached-only" } }),
    ).toMatchObject({ cardId, descriptionDetached: true, deletedAt: null });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.attachmentCount).toBe(0);
    await expectBoth(`cardId=${cardId}&hasAttachments=false`, [cardId]);
  });
});
