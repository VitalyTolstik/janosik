import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { ADMIN_ENTITIES, ADMIN_FILTER_OPTION_TYPES } from "@janosik/shared";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "filters-master@example.com";
const ADMIN_PASSWORD = "filters master password";
const USER_EMAIL = "filters-user@example.com";

/**
 * TASK-176.6 — addressable admin filters. Two boards deliberately share a
 * title and a label name; every list is scoped by the exact id, never by a
 * name search. Deleted and archived rows keep the documented status
 * semantics and pagination stays exact.
 */
describe("Admin addressable filters (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorToken: string;
  const userId = "filters-user";

  const server = () => request(app.getHttpServer());
  const at = (offset: number) => Date.UTC(2026, 0, 1) + offset * 1000;

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
        id: "filters-owner",
        email: ADMIN_EMAIL,
        displayName: "Filters master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    adminToken = login.body.accessToken;
    const operator = await prisma.adminUser.create({
      data: {
        id: "filters-operator",
        email: "filters-operator@example.com",
        displayName: "Private operator name",
        passwordHash: owner.passwordHash,
        role: "OPERATOR",
      },
    });
    await prisma.adminUser.create({
      data: {
        id: "filters-unaudited",
        email: "filters-unaudited@example.com",
        displayName: "Private disabled name",
        passwordHash: owner.passwordHash,
        disabledAt: new Date(at(0)),
      },
    });
    operatorToken = (
      await server()
        .post("/api/v1/admin/auth/login")
        .send({ email: operator.email, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken;

    await prisma.user.create({
      data: { id: userId, email: USER_EMAIL, passwordHash: "unused" },
    });

    for (const side of ["a", "b"] as const) {
      const boardId = `board-${side}`;
      await prisma.board.create({
        data: { id: boardId, title: "Same board title" },
      });
      await prisma.boardMember.create({
        data: {
          id: `member-${side}`,
          boardId,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(at(0)),
        },
      });
      await prisma.column.create({
        data: {
          id: `col-${side}`,
          boardId,
          title: "Backlog",
          position: 0,
        },
      });
      await prisma.label.create({
        data: {
          id: `label-${side}`,
          boardId,
          name: "urgent",
          color: "red",
          position: 0,
        },
      });
    }

    // Three cards on A (one archived, one deleted), one on B.
    const cards = [
      ["card-a-1", "col-a", "A one", null, null],
      ["card-a-2", "col-a", "A two", null, null],
      ["card-a-3", "col-a", "A three", null, null],
      ["card-a-archived", "col-a", "A archived", new Date(at(10)), null],
      ["card-a-deleted", "col-a", "A deleted", null, new Date(at(11))],
      ["card-b-1", "col-b", "B one", null, null],
    ] as const;
    for (const [id, columnId, title, archivedAt, deletedAt] of cards) {
      await prisma.card.create({
        data: {
          id,
          columnId,
          title,
          position: 0,
          archivedAt,
          deletedAt,
          createdAt: new Date(at(columnId === "col-b" ? 2 : 1)),
          attachmentCount: id === "card-a-1" || id === "card-b-1" ? 1 : 0,
          ...(id === "card-a-1"
            ? { assigneeId: userId, priority: "high", dueDate: new Date(1) }
            : {}),
        },
      });
    }
    await prisma.cardLabel.create({
      data: { cardId: "card-a-1", labelId: "label-a", position: 0 },
    });
    await prisma.cardLabel.create({
      data: { cardId: "card-b-1", labelId: "label-b", position: 0 },
    });

    await prisma.comment.createMany({
      data: [
        {
          id: "comment-a-live",
          cardId: "card-a-1",
          authorId: userId,
          text: "live on A",
          createdAt: new Date(at(20)),
        },
        {
          id: "comment-a-deleted",
          cardId: "card-a-1",
          authorId: userId,
          text: "deleted on A",
          deletedAt: new Date(at(21)),
          createdAt: new Date(at(21)),
        },
        {
          id: "comment-b-live",
          cardId: "card-b-1",
          authorId: userId,
          text: "live on B",
          createdAt: new Date(at(22)),
        },
      ],
    });

    await prisma.attachment.createMany({
      data: [
        {
          id: "file-a-live",
          cardId: "card-a-1",
          boardId: "board-a",
          fileName: "a-live.pdf",
          storedName: "filters-a-live",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
        },
        {
          id: "file-a-deleted",
          cardId: "card-a-1",
          boardId: "board-a",
          fileName: "a-deleted.pdf",
          storedName: "filters-a-deleted",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
          deletedAt: new Date(at(23)),
        },
        {
          id: "file-b-live",
          cardId: "card-b-1",
          boardId: "board-b",
          fileName: "b-live.pdf",
          storedName: "filters-b-live",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
        },
      ],
    });

    await prisma.command.createMany({
      data: [
        {
          id: "command-a-1",
          boardId: "board-a",
          actorId: userId,
          type: "ADD_CARD",
          payload: { newCardId: "card-a-1" },
          result: { seq: 1, versions: {} },
          touches: ["card:card-a-1", "column:col-a"],
          createdAt: new Date(at(30)),
        },
        {
          id: "command-b-1",
          boardId: "board-b",
          actorId: userId,
          type: "ADD_CARD",
          payload: { newCardId: "card-b-1" },
          result: { seq: 1, versions: {} },
          touches: ["card:card-b-1", "column:col-b"],
          createdAt: new Date(at(31)),
        },
      ],
    });

    await prisma.activity.createMany({
      data: [
        {
          id: "activity-a-1",
          boardId: "board-a",
          cardId: "card-a-1",
          actorId: userId,
          type: "comment_added",
          details: { commentId: "comment-a-live" },
          createdAt: new Date(at(40)),
        },
        {
          id: "activity-b-1",
          boardId: "board-b",
          cardId: "card-b-1",
          actorId: userId,
          type: "comment_added",
          details: { commentId: "comment-b-live" },
          createdAt: new Date(at(41)),
        },
      ],
    });
    await prisma.user.create({
      data: { id: "filter-email-only", email: "email-only@example.com" },
    });
    const disabledUser = await prisma.user.create({
      data: {
        id: "filter-disabled",
        email: "disabled@example.com",
        displayName: "Disabled Lookup User",
        disabledAt: new Date(at(0)),
      },
    });
    await prisma.boardMember.create({
      data: {
        id: "member-pending",
        boardId: "board-b",
        userId: disabledUser.id,
        role: "VIEWER",
      },
    });
    for (const [side, time] of [
      ["a", 50],
      ["b", 51],
    ] as const) {
      const createdAt = new Date(at(time));
      const boardId = `board-${side}`;
      const cardId = `card-${side}-1`;
      await prisma.checklist.create({
        data: {
          id: `checklist-${side}`,
          cardId,
          title: "Release checklist",
          position: 0,
          items: {
            create: {
              id: `item-${side}`,
              text: "Confirm release",
              position: 0,
            },
          },
        },
      });
      await prisma.cardLink.create({
        data: {
          id: `link-${side}`,
          boardId,
          fromCardId: cardId,
          toCardId: cardId,
          type: "blocks",
        },
      });
      await prisma.refreshToken.create({
        data: {
          id: `session-${side}`,
          tokenHash: `session-hash-${side}`,
          userId,
          createdAt,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.apiToken.create({
        data: {
          id: `token-${side}`,
          tokenHash: `token-hash-${side}`,
          userId,
          name: "Filter token",
          createdAt,
          revokedAt: side === "b" ? createdAt : null,
        },
      });
      await prisma.boardShare.create({
        data: {
          id: `share-${side}`,
          token: `share-secret-${side}`,
          boardId,
          createdBy: userId,
          createdAt,
        },
      });
      await prisma.adminAuditLog.create({
        data: {
          id: `audit-${side}`,
          adminId: owner.id,
          adminEmail: owner.email,
          action: "board.command",
          targetType: "board",
          targetId: boardId,
          details: { commandId: `command-${side}-1` },
          createdAt,
        },
      });
      await prisma.announcement.create({
        data: {
          id: `announcement-${side}`,
          title: `Announcement ${side}`,
          body: "Filter test",
          createdAt,
          createdBy: owner.email,
          active: side === "a",
        },
      });
    }
    await prisma.label.create({
      data: {
        id: "label-deleted",
        boardId: "board-a",
        name: "Obsolete",
        color: "blue",
        deletedAt: new Date(at(55)),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) =>
    server()
      .get(`/api/v1/admin/entities/${path}`)
      .set("Authorization", `Bearer ${adminToken}`);

  it("keeps same-name boards apart on every board-scoped list", async () => {
    const cards = await get("cards?boardId=board-a").expect(200);
    expect(cards.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-1", "card-a-2", "card-a-3"]),
    );
    expect(
      cards.body.items.every(
        (row: { boardId: string }) => row.boardId === "board-a",
      ),
    ).toBe(true);

    const comments = await get("comments?boardId=board-a").expect(200);
    expect(
      comments.body.items.every(
        (row: { id: string }) => row.id !== "comment-b-live",
      ),
    ).toBe(true);
    expect(comments.body.items.map((row: { id: string }) => row.id)).toContain(
      "comment-a-live",
    );

    const files = await get("attachments?boardId=board-a").expect(200);
    expect(
      files.body.items.map((row: { id: string }) => row.id).sort(),
    ).toEqual(["file-a-deleted", "file-a-live"]);

    const commands = await get("commands?boardId=board-a").expect(200);
    expect(commands.body.items.map((row: { id: string }) => row.id)).toEqual([
      "command-a-1",
    ]);

    const activity = await get("activity?boardId=board-a").expect(200);
    expect(activity.body.items.map((row: { id: string }) => row.id)).toEqual([
      "activity-a-1",
    ]);
  });

  it("filters cards by exact column, label and card id", async () => {
    const byColumn = await get("cards?columnId=col-a").expect(200);
    expect(
      byColumn.body.items.every(
        (row: { columnId: string }) => row.columnId === "col-a",
      ),
    ).toBe(true);
    expect(
      byColumn.body.items.some((row: { id: string }) => row.id === "card-b-1"),
    ).toBe(false);

    const byLabel = await get("cards?labelId=label-a").expect(200);
    expect(byLabel.body.items.map((row: { id: string }) => row.id)).toEqual([
      "card-a-1",
    ]);

    const byCard = await get("cards?cardId=card-b-1").expect(200);
    expect(byCard.body.items.map((row: { id: string }) => row.id)).toEqual([
      "card-b-1",
    ]);
  });

  it("combines board and column filters instead of widening them", async () => {
    const mismatch = await get("cards?boardId=board-a&columnId=col-b").expect(
      200,
    );
    expect(mismatch.body.total).toBe(0);
    expect(mismatch.body.items).toEqual([]);
  });

  it("keeps pagination exact with a structural filter", async () => {
    const page = await get("cards?boardId=board-a&limit=2&offset=2").expect(
      200,
    );
    expect(page.body.total).toBe(5);
    expect(page.body.limit).toBe(2);
    expect(page.body.offset).toBe(2);
    expect(page.body.items).toHaveLength(2);
    expect(
      page.body.items.every(
        (row: { boardId: string }) => row.boardId === "board-a",
      ),
    ).toBe(true);
  });

  it("documents deleted/archived inclusion and the status filter", async () => {
    const all = await get("cards?boardId=board-a").expect(200);
    expect(all.body.total).toBe(5);
    expect(all.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-archived", "card-a-deleted"]),
    );

    const active = await get("cards?boardId=board-a&status=active").expect(200);
    expect(active.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-1", "card-a-2", "card-a-3"]),
    );
    expect(
      active.body.items.some(
        (row: { id: string }) =>
          row.id === "card-a-archived" || row.id === "card-a-deleted",
      ),
    ).toBe(false);

    const deletedComments = await get(
      "comments?boardId=board-a&status=deleted",
    ).expect(200);
    expect(
      deletedComments.body.items.map((row: { id: string }) => row.id),
    ).toEqual(["comment-a-deleted"]);

    const liveComments = await get(
      "comments?boardId=board-a&status=active",
    ).expect(200);
    expect(
      liveComments.body.items.map((row: { id: string }) => row.id),
    ).toEqual(["comment-a-live"]);
    expect(
      liveComments.body.items.some(
        (row: { id: string }) => row.id === "comment-a-deleted",
      ),
    ).toBe(false);

    const allComments = await get("comments?boardId=board-a").expect(200);
    expect(allComments.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["comment-a-live", "comment-a-deleted"]),
    );
  });

  it("rejects malformed id filters with 400", async () => {
    await get("cards?boardId=bad%24id").expect(400);
    await get("cards?columnId=../etc").expect(400);
    await get("comments?labelId=").expect(200);
  });

  const specialized = [
    "users",
    "boards",
    "cards",
    "comments",
    "commands",
    "audit",
    "sessions",
    "tokens",
    "shares",
    "announcements",
  ];
  const getRoute = (path: string, token = adminToken) =>
    server()
      .get(`/api/v1/admin/${path}`)
      .set("Authorization", `Bearer ${token}`);
  const rowIds = (rows: { id?: string; cardId?: string }[]) =>
    rows.map((row) => row.id ?? row.cardId).sort();

  const structure = [
    ["boardId", "board-a"],
    ["columnId", "col-a"],
    ["labelId", "label-a"],
    ["cardId", "card-a-1"],
  ] as const;
  const legacyScopes = [
    ["boards", ["board-a"]],
    ["columns", ["col-a"]],
    ["checklists", ["checklist-a"]],
    ["checklistItems", ["item-a"]],
    ["cardLabels", ["card-a-1"]],
    ["comments", ["comment-a-deleted", "comment-a-live"]],
    ["attachments", ["file-a-deleted", "file-a-live"]],
    ["activity", ["activity-a-1"]],
  ] as const;
  const allCardsA = [
    "card-a-1",
    "card-a-2",
    "card-a-3",
    "card-a-archived",
    "card-a-deleted",
  ];
  const legacyCases: [string, string, readonly string[]][] = [
    ...legacyScopes.flatMap(([entity, ids]) =>
      structure.map(([key, value]): [string, string, readonly string[]] => [
        entity,
        `${key}=${value}`,
        ids,
      ]),
    ),
    ["labels", "boardId=board-a", ["label-a", "label-deleted"]],
    ["labels", "columnId=col-a", ["label-a"]],
    ["labels", "labelId=label-a", ["label-a"]],
    ["labels", "cardId=card-a-1", ["label-a"]],
    ["cards", "boardId=board-a", allCardsA],
    ["cards", "columnId=col-a", allCardsA],
    ["cards", "labelId=label-a", ["card-a-1"]],
    ["cards", "cardId=card-a-1", ["card-a-1"]],
    ["cards", `assigneeId=${userId}`, ["card-a-1"]],
    ["cards", "boardId=board-a&unassigned=true", allCardsA.slice(1)],
    ["cards", "priority=high", ["card-a-1"]],
    ["cards", "due=overdue", ["card-a-1"]],
    ["cards", "hasAttachments=true", ["card-a-1", "card-b-1"]],
    [
      "cards",
      "labelId=label-a&labelId=label-b&labelMatch=any",
      ["card-a-1", "card-b-1"],
    ],
    ["cards", "labelId=label-a&labelId=label-b&labelMatch=all", []],
    ["cards", `from=${at(2)}`, ["card-b-1"]],
    ["cards", `to=${at(1)}`, allCardsA],
    ["commands", "boardId=board-a", ["command-a-1"]],
    ["commands", "columnId=col-a", ["command-a-1"]],
    ["commands", "cardId=card-a-1", ["command-a-1"]],
    ["commands", "commandId=command-a-1", ["command-a-1"]],
    ["audit", "commandId=command-a-1", ["audit-a"]],
    ["cardLinks", "boardId=board-a", ["link-a"]],
    ["cardLinks", "cardId=card-a-1", ["link-a"]],
    ["boardMembers", "boardId=board-a", ["member-a"]],
    ["boardMembers", "status=disabled", ["member-pending"]],
    ["boardMembers", "status=active", ["member-a", "member-b"]],
    ["shares", "boardId=board-a", ["share-a"]],
    ["tokens", "status=active", ["token-a"]],
    ["tokens", "status=disabled", ["token-b"]],
    ["announcements", "status=active", ["announcement-a"]],
    ["announcements", "status=disabled", ["announcement-b"]],
    ["announcements", "status=deleted", ["announcement-b"]],
    ["comments", `from=${at(22)}`, ["comment-b-live"]],
    ["comments", `to=${at(21)}`, ["comment-a-deleted", "comment-a-live"]],
    ["activity", `from=${at(41)}`, ["activity-b-1"]],
    ["activity", `to=${at(40)}`, ["activity-a-1"]],
    ["commands", `from=${at(31)}`, ["command-b-1"]],
    ["commands", `to=${at(30)}`, ["command-a-1"]],
    ["audit", `from=${at(51)}&search=board.command`, ["audit-b"]],
    ["audit", `to=${at(50)}&search=board.command`, ["audit-a"]],
    ...[
      ["sessions", "session"],
      ["tokens", "token"],
      ["shares", "share"],
    ].flatMap(([entity, prefix]): [string, string, readonly string[]][] => [
      [entity, `from=${at(51)}`, [`${prefix}-b`]],
      [entity, `to=${at(50)}`, [`${prefix}-a`]],
    ]),
  ];

  it.each(legacyCases)(
    "preserves %s with %s",
    async (entity, query, expected) => {
      const paths = [
        ...(entity === "shares" ? [] : [`entities/${entity}`]),
        ...(specialized.includes(entity) ? [entity] : []),
      ];
      for (const path of paths) {
        const { body } = await getRoute(`${path}?${query}`).expect(200);
        expect(rowIds(Array.isArray(body) ? body : body.items)).toEqual(
          expected,
        );
        if (!Array.isArray(body)) expect(body.total).toBe(expected.length);
      }
    },
  );

  it.each([
    ...ADMIN_ENTITIES.filter((entity) => entity !== "admins"),
    "shares",
  ])(
    "accepts default and all status and rejects an unsupported status on %s",
    async (entity) => {
      const paths = [
        ...(entity === "shares" ? [] : [`entities/${entity}`]),
        ...(specialized.includes(entity) ? [entity] : []),
      ];
      for (const path of paths) {
        const defaultPage = await getRoute(path).expect(200);
        const all = await getRoute(`${path}?status=all`).expect(200);
        expect(all.body).toEqual(defaultPage.body);
        const invalid = await getRoute(`${path}?status=owner`).expect(400);
        expect(invalid.body).toMatchObject({
          code: "unsupported_filter",
          filter: "status",
        });
      }
    },
  );

  it.each([
    ["entities/users", "assigneeId", "someone"],
    ["users", "assigneeId", "someone"],
    ["entities/boards", "from", String(at(0))],
    ["boards", "from", String(at(0))],
    ["entities/cards", "unknownKey", "true"],
    ["cards", "unknownKey", "true"],
    ["entities/commands", "labelId", "label-a"],
    ["commands", "labelId", "label-a"],
    ["entities/audit", "boardId", "board-a"],
    ["audit", "boardId", "board-a"],
    ["entities/comments", "status", "archived"],
    ["comments", "status", "archived"],
    ["entities/boards", "status", "disabled"],
    ["boards", "status", "disabled"],
    ["shares", "status", "disabled"],
    ["announcements", "columnId", "col-a"],
  ])("rejects %s with unsupported %s", async (path, key, value) => {
    const { body } = await getRoute(`${path}?${key}=${value}`).expect(400);
    const entity = path.replace(/^entities\//, "");
    expect(body).toMatchObject({
      statusCode: 400,
      error: "Bad Request",
      code: "unsupported_filter",
      filter: key,
      message: `Filter ${key} is not supported for ${entity}`,
    });
  });

  it.each([
    ["cards", "boardId=board-a&boardId=board-a"],
    ["cards", "cardId=card-a-1&cardId=card-b-1"],
    ["cards", "columnId=col-a&columnId=col-a"],
    ["comments", "labelId=label-a&labelId=label-a"],
    ["cards", "limit=1&limit=2"],
    ["cards", "offset=0&offset=0"],
    ["cards", "status=all&status=all"],
    ["cards", "search=a&search=b"],
    ["commands", `from=${at(30)}&from=${at(31)}`],
    ["commands", "commandId=command-a-1&commandId=command-b-1"],
    ["cards", "due=soon&due=soon"],
    ["cards", "hasAttachments=true&hasAttachments=false"],
    ["cards", "unassigned=true&unassigned=true"],
    ["cards", "labelMatch=any&labelMatch=all"],
    ["cards", "from=0&from=1"],
    ["cards", "to=0&to=1"],
    ["cards", "due=yesterday"],
    ["cards", "hasAttachments=0"],
    ["cards", "unassigned=1"],
    ["cards", "priority=medium&priority=urgent"],
    ["cards", "labelMatch=ALL"],
    ["cards", "assigneeId=ok&assigneeId=../bad"],
    ["cards", "labelId=label-a&labelId=%20"],
    [
      "cards",
      Array.from({ length: 21 }, (_, i) => `labelId=label-${i}`).join("&"),
    ],
    [
      "cards",
      Array.from({ length: 21 }, (_, i) => `assigneeId=user-${i}`).join("&"),
    ],
    [
      "cards",
      [
        ...Array.from({ length: 20 }, (_, i) => `labelId=l-${i}`),
        ...Array.from({ length: 13 }, (_, i) => `assigneeId=u-${i}`),
      ].join("&"),
    ],
    ["cards", "labelId=label-a,label-b"],
  ])("rejects invalid values on both %s routes (%s)", async (entity, query) => {
    await getRoute(`entities/${entity}?${query}`).expect(400);
    await getRoute(`${entity}?${query}`).expect(400);
  });

  const deferredCases = [
    ["users", "verified=true", "verified"],
    ["users", "from=0", "from"],
    ["boards", "adminMemberId=someone", "adminMemberId"],
    ["boards", "adminMemberId=someone&adminMemberId=someone", "adminMemberId"],
    ["boards", "labelMatch=all", "labelMatch"],
    ["comments", "due=none", "due"],
    ["attachments", "hasAttachments=false", "hasAttachments"],
    ["cardLinks", "type=blocks", "type"],
    ["comments", "authorId=someone", "authorId"],
    ["attachments", "mime=image", "mime"],
    ["activity", "actorId=someone", "actorId"],
    ["commands", "type=ADD_CARD", "type"],
    ["audit", "adminId=someone", "adminId"],
    ["audit", "action=board.command", "action"],
    ["audit", "targetId=card-a-1&targetId=card-b-1", "targetId"],
  ];
  it.each(deferredCases)(
    "returns unsupported_filter for %s?%s",
    async (entity, query, filter) => {
      const paths = [
        `entities/${entity}`,
        ...(specialized.includes(entity) ? [entity] : []),
      ];
      for (const path of paths) {
        const { body } = await getRoute(`${path}?${query}`).expect(400);
        expect(body).toMatchObject({
          statusCode: 400,
          code: "unsupported_filter",
          error: "Bad Request",
          filter,
          retryable: false,
        });
      }
    },
  );

  it.each(["entities/commands", "commands"])(
    "treats blank offset and date bounds as omitted on %s",
    async (path) => {
      const initial = await getRoute(path).expect(200);
      const blanks = await getRoute(`${path}?offset=&from=&to=%20`).expect(200);
      expect(blanks.body).toEqual(initial.body);
    },
  );

  const lookup = (query: string, token: string) =>
    getRoute(`filter-options?${query}`, token);
  const lookupCases = [
    ["board", "board-a", "Same board", null, null, "active"],
    ["column", "col-b", "Backlog", "board-b", null, "active"],
    ["label", "label-b", "urgent", "board-b", null, "active"],
    ["user", "filter-disabled", "Disabled Lookup User", null, null, "disabled"],
    ["card", "card-a-archived", "A archived", "board-a", "col-a", "archived"],
    [
      "checklist",
      "checklist-b",
      "Release checklist",
      "board-b",
      null,
      "active",
    ],
    ["auditActor", "filters-owner", ADMIN_EMAIL, null, null, null],
    ["action", "board.command", "board.command", null, null, null],
    ["commandType", "ADD_CARD", "ADD_CARD", null, null, null],
    ["activityType", "comment_added", "comment_added", null, null, null],
    ["targetType", "board", "board", null, null, null],
  ] as const;

  it.each(["owner", "operator"])(
    "resolves every lookup type with minimal fields for %s",
    async (role) => {
      const token = role === "owner" ? adminToken : operatorToken;
      expect(lookupCases.map(([type]) => type)).toEqual(
        ADMIN_FILTER_OPTION_TYPES,
      );
      for (const [type, id, q, boardId, columnId, state] of lookupCases) {
        const search = await lookup(
          `type=${type}&q=${encodeURIComponent(`  ${q}  `)}`,
          token,
        ).expect(200);
        const resolved = await lookup(
          `type=${type}&ids=${id}&ids=missing-id&ids=${id}&limit=1`,
          token,
        ).expect(200);
        expect(resolved.body.missing).toEqual(["missing-id"]);
        expect(resolved.body.hasMore).toBe(false);
        expect(resolved.body.items).toHaveLength(1);
        const item = resolved.body.items[0];
        expect(search.body.items).toContainEqual(item);
        expect(item).toEqual({
          id,
          label: expect.any(String),
          sublabel: item.sublabel,
          boardId,
          columnId,
          state,
          ...(type === "label" ? { color: "red" } : {}),
        });
        if (type === "auditActor")
          expect(item).toMatchObject({
            label: ADMIN_EMAIL,
            sublabel: null,
            state: null,
          });
      }
    },
  );

  it("limits q searches and returns all unscoped IDs even with limit=1", async () => {
    const ranked = await lookup(
      "type=board&q=board-b&limit=1",
      adminToken,
    ).expect(200);
    expect(rowIds(ranked.body.items)).toEqual(["board-b"]);
    const capped = await lookup("type=board&q=same&limit=1", adminToken).expect(
      200,
    );
    expect(rowIds(capped.body.items)).toEqual(["board-a"]);
    expect(capped.body.hasMore).toBe(true);
    const columns = await lookup(
      "type=column&boardId=board-a&q=backlog",
      adminToken,
    ).expect(200);
    expect(rowIds(columns.body.items)).toEqual(["col-a"]);
    const cards = await lookup(
      "type=card&boardId=board-a&columnId=col-b&q=one",
      adminToken,
    ).expect(200);
    expect(cards.body.items).toEqual([]);
    const lists = await lookup(
      "type=checklist&cardId=card-b-1&q=release",
      adminToken,
    ).expect(200);
    expect(rowIds(lists.body.items)).toEqual(["checklist-b"]);
    const unscoped = await lookup(
      "type=card&boardId=board-a&columnId=col-a&ids=card-b-1&ids=card-a-deleted&ids=unknown&limit=1",
      adminToken,
    ).expect(200);
    expect(unscoped.body).toMatchObject({
      hasMore: false,
      missing: ["unknown"],
      items: [
        {
          id: "card-a-deleted",
          boardId: "board-a",
          columnId: "col-a",
          state: "deleted",
        },
        {
          id: "card-b-1",
          boardId: "board-b",
          columnId: "col-b",
          state: "active",
        },
      ],
    });
    const labels = await lookup(
      "type=label&ids=label-deleted",
      adminToken,
    ).expect(200);
    expect(labels.body.items[0]).toMatchObject({
      id: "label-deleted",
      state: "deleted",
      color: "blue",
    });
  });

  it("resolves a checklist by id across board, column and card scopes", async () => {
    const { body } = await lookup(
      "type=checklist&boardId=board-a&columnId=col-a&cardId=card-a-1&ids=checklist-b",
      adminToken,
    ).expect(200);
    expect(body).toMatchObject({
      items: [{ id: "checklist-b", boardId: "board-b" }],
      missing: [],
      hasMore: false,
    });
  });

  it("uses the user's name as the label and falls back to email", async () => {
    const named = await lookup(
      "type=user&q=disabled%40example.com",
      adminToken,
    ).expect(200);
    expect(named.body.items).toContainEqual({
      id: "filter-disabled",
      label: "Disabled Lookup User",
      sublabel: "disabled@example.com",
      boardId: null,
      columnId: null,
      state: "disabled",
    });
    const emailOnly = await lookup(
      "type=user&ids=filter-email-only",
      adminToken,
    ).expect(200);
    expect(emailOnly.body.items).toEqual([
      {
        id: "filter-email-only",
        label: "email-only@example.com",
        sublabel: null,
        boardId: null,
        columnId: null,
        state: "active",
      },
    ]);
  });

  it.each(["owner", "operator"])(
    "enforces lookup bounds and hides unaudited actors for %s",
    async (role) => {
      const token = role === "owner" ? adminToken : operatorToken;
      const all = await lookup("type=auditActor", token).expect(200);
      expect(rowIds(all.body.items)).toEqual([
        "filters-operator",
        "filters-owner",
      ]);
      const opaque = await lookup(
        "type=auditActor&ids=filters-unaudited&q=filters-owner",
        token,
      ).expect(200);
      expect(opaque.body).toEqual({
        items: [],
        missing: ["filters-unaudited"],
        hasMore: false,
      });
      const fullLimit = await lookup(
        `type=user&limit=50&q=${"a".repeat(200)}`,
        token,
      ).expect(200);
      expect(fullLimit.body).toEqual({
        items: [],
        missing: [],
        hasMore: false,
      });
      await lookup(
        `type=user&${new URLSearchParams(Array.from({ length: 20 }, (_, i): [string, string] => ["ids", `missing-${i}`]))}`,
        token,
      ).expect(200);
      const duplicates = await lookup(
        `type=user${"&ids=filter-disabled&ids=+filter-disabled+".repeat(21)}`,
        token,
      ).expect(200);
      expect(rowIds(duplicates.body.items)).toEqual(["filter-disabled"]);
      expect(duplicates.body.missing).toEqual([]);
      for (const query of [
        "type=admin",
        "type=bad",
        "q=alice",
        "type=user&type=user",
        "type=user&q=a&q=b",
        "type=user&limit=51",
        "type=user&limit=0",
        "type=user&limit=1.5",
        "type=user&limit=1&limit=1",
        "type=user&ids=invalid/id",
        "type=card&columnId=invalid/id",
        "type=user&ids=",
        `type=user&q=${"a".repeat(201)}`,
        `type=user&${new URLSearchParams(Array.from({ length: 21 }, (_, i): [string, string] => ["ids", `missing-${i}`]))}`,
      ])
        await lookup(query, token).expect(400);
      await getRoute("admins", token).expect(role === "owner" ? 200 : 403);
    },
  );

  it("requires a master session for lookups", async () => {
    await server().get("/api/v1/admin/filter-options?type=board").expect(401);
  });
});
