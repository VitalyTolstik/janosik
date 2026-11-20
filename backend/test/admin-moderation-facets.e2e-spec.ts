import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash } from "argon2";
import request from "supertest";
import {
  COMMENT_KINDS,
  type AdminAttachmentRowDto,
  type AdminCommentRowDto,
  type AdminPage,
} from "@janosik/shared";
import { AppModule } from "@/app.module";
import { CARD_ATTACHMENT_WHERE } from "@/attachments/card-attachments";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const BOARD = "moderated-board";
const OTHER_BOARD = "other-board";
const BOARD_TITLE = "Moderated project";
const CARD = "moderated-card";
const INLINE_CARD = "inline-only-card";
const ARCHIVED_CARD = "archived-parent";
const DELETED_CARD = "deleted-parent";
const OTHER_CARD = "other-card";
const USER = "moderation-author";
const OTHER_USER = "moderation-colleague";
const EMAIL = "moderation-operator@example.com";
const PASSWORD = "moderation operator password";
const BOUNDARY = Date.UTC(2026, 0, 1);

describe("Admin moderation facets (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let unprocessedVideoId: string;
  const api = () => request(app.getHttpServer());
  const get = (path: string) =>
    api().get(`/api/v1/admin/${path}`).set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const passwordHash = await hash(PASSWORD, { type: argon2id });
    await prisma.adminUser.create({
      data: { email: EMAIL, role: "OPERATOR", passwordHash },
    });
    token = (
      await api()
        .post("/api/v1/admin/auth/login")
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200)
    ).body.accessToken;

    await prisma.user.createMany({
      data: [USER, OTHER_USER].map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash,
        emailVerifiedAt: new Date(),
      })),
    });
    await prisma.board.createMany({
      data: [
        { id: BOARD, title: BOARD_TITLE, archivedAt: new Date(BOUNDARY) },
        { id: OTHER_BOARD, title: "Elsewhere" },
      ],
    });
    await prisma.boardMember.create({
      data: {
        boardId: OTHER_BOARD,
        userId: USER,
        role: "ADMIN",
        acceptedAt: new Date(),
      },
    });
    await prisma.column.createMany({
      data: [BOARD, OTHER_BOARD].map((boardId) => ({
        id: `${boardId}-column`,
        boardId,
        title: "Triage",
        position: 0,
      })),
    });
    await prisma.card.createMany({
      data: [CARD, INLINE_CARD, ARCHIVED_CARD, DELETED_CARD, OTHER_CARD].map(
        (id, position) => ({
          id,
          title: id,
          columnId: `${id === OTHER_CARD ? OTHER_BOARD : BOARD}-column`,
          archivedAt: id === ARCHIVED_CARD ? new Date(BOUNDARY) : null,
          deletedAt: id === DELETED_CARD ? new Date(BOUNDARY) : null,
          position,
        }),
      ),
    });

    await prisma.comment.createMany({
      data: [
        { id: "c-blocker", kind: "blocker", createdAt: new Date(BOUNDARY) },
        {
          id: "c-question",
          kind: "question",
          createdAt: new Date(BOUNDARY + 1),
        },
        { id: "c-before", kind: "question", createdAt: new Date(BOUNDARY - 1) },
        { id: "c-note" },
        { id: "c-status", kind: "status" },
        {
          id: "c-evidence",
          kind: "evidence",
          cardId: ARCHIVED_CARD,
          authorId: OTHER_USER,
        },
        {
          id: "c-handoff",
          kind: "handoff",
          cardId: DELETED_CARD,
          authorId: OTHER_USER,
        },
        { id: "c-deleted", kind: "blocker", deletedAt: new Date(BOUNDARY) },
        { id: "c-other-board", kind: "blocker", cardId: OTHER_CARD },
      ].map((row) => ({
        cardId: CARD,
        authorId: USER,
        text: `moderation ${row.id}`,
        createdAt: new Date(BOUNDARY - 5),
        ...row,
      })),
    });
    await prisma.attachment.createMany({
      data: [
        {
          id: "inline",
          mimeType: "image/png",
          isInline: true,
          cardId: INLINE_CARD,
        },
        {
          id: "detached",
          mimeType: "image/jpeg",
          descriptionEmbed: true,
          descriptionDetached: true,
        },
        {
          id: "pdf",
          mimeType: "application/pdf",
          createdAt: new Date(BOUNDARY),
        },
        {
          id: "pdf-after",
          mimeType: "APPLICATION/PDF",
          createdAt: new Date(BOUNDARY + 1),
        },
        {
          id: "pdf-before",
          mimeType: "application/pdf",
          createdAt: new Date(BOUNDARY - 1),
        },
        {
          id: "word",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        { id: "plain", mimeType: "text/plain" },
        { id: "legacy-office", mimeType: "application/vnd.ms-excel" },
        { id: "rtf", mimeType: "APPLICATION/RTF" },
        { id: "msword", mimeType: "application/msword" },
        { id: "powerpoint", mimeType: "application/vnd.ms-powerpoint" },
        { id: "json", mimeType: "application/json" },
        { id: "archive", mimeType: "application/zip" },
        { id: "audio", mimeType: "audio/mpeg" },
        { id: "queued", mimeType: "video/mp4", transcodeStatus: "pending" },
        {
          id: "done",
          mimeType: "video/mp4",
          transcodeStatus: "done",
          cardId: ARCHIVED_CARD,
          uploadedById: OTHER_USER,
        },
        {
          id: "failed",
          mimeType: "video/webm",
          transcodeStatus: "failed",
          cardId: DELETED_CARD,
        },
        { id: "deleted", mimeType: "image/png", deletedAt: new Date(BOUNDARY) },
      ].map((row) => ({
        cardId: CARD,
        boardId: BOARD,
        uploadedById: USER,
        fileName: `moderation-${row.id}`,
        storedName: row.id,
        sizeBytes: 15,
        createdAt: new Date(BOUNDARY - 5),
        ...row,
      })),
    });

    await prisma.featureFlag.create({
      data: {
        key: "video_transcode",
        enabled: true,
        perUser: { [USER]: false },
      },
    });
    const { body: login } = await api()
      .post("/api/v1/auth/login")
      .send({ email: `${USER}@example.com`, password: PASSWORD })
      .expect(200);
    const { body: uploaded } = await api()
      .post(`/api/v1/cards/${OTHER_CARD}/attachments`)
      .set("Authorization", `Bearer ${login.accessToken}`)
      .attach("file", join(__dirname, "fixtures", "sample-video.mp4"), {
        filename: "unprocessed.mp4",
        contentType: "video/mp4",
      })
      .expect(201);
    expect(uploaded.transcodeStatus).toBe("none");
    unprocessedVideoId = uploaded.id;
    await prisma.featureFlag.delete({ where: { key: "video_transcode" } });
  });

  afterAll(async () => {
    // The queued row has no blob and must not be picked up by boot recovery.
    await prisma.attachment.deleteMany({ where: { id: "queued" } });
    await app.close();
  });

  const comments = async (query: string, specialized = false) =>
    (
      await get(
        `${specialized ? "comments" : "entities/comments"}?${query}`,
      ).expect(200)
    ).body as AdminPage<AdminCommentRowDto>;
  const attachments = async (query: string) =>
    (await get(`entities/attachments?${query}`).expect(200))
      .body as AdminPage<AdminAttachmentRowDto>;

  function expectRows(page: AdminPage<{ id: string }>, ids: string[]) {
    expect(page.items.map(({ id }) => id).sort()).toEqual([...ids].sort());
    expect(page.total).toBe(ids.length);
  }

  it.each([false, true])(
    "combines board, card, author, kind, status, search and inclusive period on comments (specialized: %s)",
    async (specialized) => {
      const scope = `boardId=${BOARD}&cardId=${CARD}&authorId=${USER}&kind=question&kind=blocker&status=active&search=moderation&from=${BOUNDARY}&to=${BOUNDARY + 1}`;
      expectRows(await comments(scope, specialized), [
        "c-question",
        "c-blocker",
      ]);
      for (const [offset, id] of ["c-question", "c-blocker"].entries()) {
        expect(
          await comments(`${scope}&limit=1&offset=${offset}`, specialized),
        ).toMatchObject({
          total: 2,
          limit: 1,
          offset,
          items: [{ id, kind: id.slice(2) }],
        });
      }
      expectRows(
        await comments(`boardId=${OTHER_BOARD}&cardId=${CARD}`, specialized),
        [],
      );
      expectRows(await comments(`authorId=${OTHER_USER}`, specialized), [
        "c-evidence",
        "c-handoff",
      ]);
    },
  );

  it.each(COMMENT_KINDS)(
    "selects the %s comment kind and returns it in the row",
    async (kind) => {
      const page = await comments(`boardId=${BOARD}&kind=${kind}`);
      expect(page.total).toBe(
        kind === "question" || kind === "blocker" ? 2 : 1,
      );
      expect(page.items.every((row) => row.kind === kind)).toBe(true);
    },
  );

  it.each([
    ["image", ["inline", "detached", "deleted"]],
    ["video", ["queued", "done", "failed"]],
    ["pdf", ["pdf", "pdf-after", "pdf-before"]],
    [
      "document",
      ["word", "plain", "legacy-office", "rtf", "msword", "powerpoint"],
    ],
    ["other", ["archive", "audio", "json"]],
  ])("selects the %s MIME family", async (family, ids) => {
    expectRows(await attachments(`boardId=${BOARD}&mime=${family}`), ids);
  });

  it.each([
    ["pending", "queued"],
    ["done", "done"],
    ["failed", "failed"],
  ])(
    "finds %s transcodes without including other states",
    async (status, id) => {
      expectRows(await attachments(`mime=video&transcode=${status}`), [id]);
    },
  );

  it("finds both non-video files and videos uploaded while transcoding was disabled", async () => {
    expectRows(await attachments("mime=video&transcode=none"), [
      unprocessedVideoId,
    ]);
    expectRows(await attachments("mime=pdf&transcode=none"), [
      "pdf",
      "pdf-after",
      "pdf-before",
    ]);
    expect((await attachments("transcode=none")).total).toBe(16);
  });

  it("combines attachment facets and paginates across the inclusive period boundary with an exact total", async () => {
    const scope = `boardId=${BOARD}&cardId=${CARD}&uploadedById=${USER}&mime=pdf&transcode=none&status=active&search=moderation&from=${BOUNDARY}`;
    expectRows(await attachments(scope), ["pdf", "pdf-after"]);
    expect(await attachments(`${scope}&limit=1&offset=1`)).toMatchObject({
      total: 2,
      limit: 1,
      offset: 1,
      items: [{ id: "pdf", boardTitle: BOARD_TITLE }],
    });
    expectRows(await attachments(`${scope}&to=${BOUNDARY}`), ["pdf"]);
    expectRows(await attachments(`uploadedById=${OTHER_USER}`), ["done"]);
    expectRows(await attachments(`boardId=${OTHER_BOARD}&cardId=${CARD}`), []);
  });

  it("uses each row's own deletion status even under archived or deleted parents", async () => {
    expectRows(await comments(`boardId=${BOARD}&status=deleted`), [
      "c-deleted",
    ]);
    expectRows(await comments(`authorId=${OTHER_USER}&status=active`), [
      "c-evidence",
      "c-handoff",
    ]);
    expectRows(await attachments(`boardId=${BOARD}&status=deleted`), [
      "deleted",
    ]);
    expectRows(await attachments(`cardId=${ARCHIVED_CARD}&status=active`), [
      "done",
    ]);
    expectRows(await attachments(`cardId=${DELETED_CARD}&status=active`), [
      "failed",
    ]);
    expect((await comments(`boardId=${BOARD}&status=all`)).total).toBe(8);
    expect((await attachments(`boardId=${BOARD}&status=all`)).total).toBe(18);
  });

  it("treats empty and whitespace-only author and uploader ids as absent", async () => {
    const scope = `boardId=${BOARD}`;
    for (const value of ["", "%20%20"]) {
      for (const specialized of [false, true]) {
        const baseline = await comments(scope, specialized);
        expectRows(
          await comments(`${scope}&authorId=${value}`, specialized),
          baseline.items.map(({ id }) => id),
        );
      }
      const baseline = await attachments(scope);
      expectRows(
        await attachments(`${scope}&uploadedById=${value}`),
        baseline.items.map(({ id }) => id),
      );
    }
  });

  it("includes inline and detached rows while the card counter excludes them", async () => {
    const inline = await attachments(`cardId=${INLINE_CARD}`);
    expect(inline.items).toMatchObject([
      { id: "inline", isInline: true, descriptionDetached: false },
    ]);
    const detached = await attachments("search=moderation-detached");
    expect(detached.items).toMatchObject([
      { id: "detached", isInline: false, descriptionDetached: true },
    ]);
    expect(
      await prisma.attachment.count({
        where: { ...CARD_ATTACHMENT_WHERE, cardId: INLINE_CARD },
      }),
    ).toBe(0);
    expect(
      await prisma.attachment.count({
        where: { ...CARD_ATTACHMENT_WHERE, id: "detached" },
      }),
    ).toBe(0);
    expect(
      await prisma.card.findUniqueOrThrow({
        where: { id: INLINE_CARD },
        select: { attachmentCount: true },
      }),
    ).toEqual({ attachmentCount: 0 });
    const path = `entities/cards?cardId=${INLINE_CARD}&hasAttachments=`;
    expect((await get(`${path}false`).expect(200)).body).toMatchObject({
      total: 1,
      items: [{ id: INLINE_CARD }],
    });
    expect((await get(`${path}true`).expect(200)).body.total).toBe(0);
  });

  it("supplies the same moderation metadata in detail windows and global search", async () => {
    const comment = { id: "c-blocker", kind: "blocker" };
    const file = {
      id: "detached",
      boardTitle: BOARD_TITLE,
      isInline: false,
      descriptionDetached: true,
    };
    for (const route of [
      `cards/${CARD}/detail`,
      `users/${USER}/detail`,
      "search?q=moderation-detached",
    ]) {
      const { body } = await get(route).expect(200);
      expect(body.attachments).toEqual(
        expect.arrayContaining([expect.objectContaining(file)]),
      );
    }
    for (const route of [
      `cards/${CARD}/detail`,
      `users/${USER}/detail`,
      "search?q=c-blocker",
    ]) {
      const { body } = await get(route).expect(200);
      expect(body.comments).toEqual(
        expect.arrayContaining([expect.objectContaining(comment)]),
      );
    }
  });

  it("resolves an exact user and a board-scoped card as an operator", async () => {
    expect(
      (await get(`filter-options?type=user&ids=${USER}`).expect(200)).body
        .items,
    ).toMatchObject([{ id: USER }]);
    expect(
      (
        await get(
          `filter-options?type=card&boardId=${BOARD}&q=${INLINE_CARD}`,
        ).expect(200)
      ).body.items,
    ).toMatchObject([{ id: INLINE_CARD, boardId: BOARD }]);
  });

  it.each([
    ["comments", "authorId=bad.id"],
    ["comments", "authorId=a&authorId=b"],
    ["comments", "kind=invalid"],
    ["comments", "status=archived"],
    ["entities/comments", "kind=question&kind=invalid"],
    ["entities/attachments", "uploadedById=a&uploadedById=b"],
    ["entities/attachments", "uploadedById=bad.id"],
    ["entities/attachments", "mime=image&mime=pdf"],
    ["entities/attachments", "mime=invalid"],
    ["entities/attachments", "transcode=invalid"],
    ["entities/attachments", "from=invalid"],
    ["entities/attachments", "status=archived"],
  ])("rejects invalid facets on %s?%s", async (path, query) => {
    await get(`${path}?${query}`).expect(400);
  });
});
