import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { AttentionNotification } from "@prisma/client";
import type { CommentDto } from "@janosik/shared";
import { extractMentionUserIds, mentionMarkdown } from "@janosik/shared";

import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { notificationMailId } from "@/mailer/notification-delivery.service";
import { AccountDeletionService } from "@/users/account-deletion.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "mention-owner@example.com";
const MEMBER_EMAIL = "mention-member@example.com";
const OUTSIDER_EMAIL = "mention-outsider@example.com";
const ERASED_EMAIL = "mention-erased@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-177.12 — explicit mention links in comments.
 *
 * The suite pins the write-time contract (only active board members can be
 * mentioned; bare `@name` is plain text), the attention fan-out (author is
 * skipped, repeated tokens dedupe, opt-out keeps the inbox row but drops the
 * letter) and the deletion contract (a deleted comment or board leaves no
 * live mention notification behind).
 */
describe("Comment mentions (TASK-177.12, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: { token: string; id: string };
  let member: { token: string; id: string };
  let outsider: { token: string; id: string };
  let erasedAuthor: { token: string; id: string };
  let boardId: string;
  let cardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    owner = await register(OWNER_EMAIL, "Owner");
    member = await register(MEMBER_EMAIL, "Member");
    outsider = await register(OUTSIDER_EMAIL, "Outsider");
    erasedAuthor = await register(ERASED_EMAIL, "Erased author");

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: "Mentions board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await invite(MEMBER_EMAIL, member.token);
    await invite(ERASED_EMAIL, erasedAuthor.token);
    await command({ type: "ADD_COLUMN", newColumnId: "col-1", title: "Todo" });
    cardId = await createCard("Release checklist");
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
    inviteeSession: string,
    targetBoard = boardId,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoard}/members`)
      .set(auth(owner.token))
      .send({ email, role: "MEMBER" })
      .expect(201);
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(inviteeSession))
      .expect(200)
      .then(
        (res) =>
          (res.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === targetBoard,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(inviteeSession))
      .expect(200);
  }

  async function command(
    action: Record<string, unknown>,
    targetBoard = boardId,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoard}/commands`)
      .set(auth(owner.token))
      .send({
        commandId: randomUUID(),
        action: { boardId: targetBoard, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function createCard(
    title: string,
    targetBoard = boardId,
    columnId = "col-1",
  ): Promise<string> {
    const id = randomUUID();
    await command(
      {
        type: "ADD_CARD",
        newCardId: id,
        columnId,
        title,
      },
      targetBoard,
    );
    return id;
  }

  function createComment(
    text: string,
    targetCard = cardId,
    token = owner.token,
    commandId: string = randomUUID(),
  ) {
    return server()
      .post(`/api/v1/cards/${targetCard}/comments`)
      .set(auth(token))
      .send({ text, commandId });
  }

  function mentionRow(commentId: string, userId: string) {
    return prisma.attentionNotification.findUnique({
      where: { dedupKey: `comment.mention:${commentId}:${userId}` },
    });
  }

  async function waitForRow(
    commentId: string,
    userId: string,
  ): Promise<AttentionNotification> {
    let row: AttentionNotification | null = null;
    await waitFor(async () => {
      row = await mentionRow(commentId, userId);
      return row !== null;
    });
    return row!;
  }

  async function waitFor(
    probe: () => Promise<boolean>,
    timeout = 5_000,
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("condition was not met before the timeout");
  }

  it("validates mention ids and notifies each active member except the author", async () => {
    const response = await createComment(
      `Hi ${mentionMarkdown("Member", member.id)} and ${mentionMarkdown(
        "Member again",
        member.id,
      )}; ${mentionMarkdown("Owner", owner.id)}; bare @Outsider stays text.`,
    ).expect(201);
    const comment = response.body as CommentDto;

    expect(comment.mentionedUserIds).toEqual([member.id, owner.id]);
    expect(comment.text).toContain("janosik.invalid/mention");

    const row = await waitForRow(comment.id, member.id);
    expect(row.type).toBe("comment.mention");
    expect(row.userId).toBe(member.id);
    expect(row.boardId).toBe(boardId);
    expect(row.data).toEqual(
      expect.objectContaining({
        cardId,
        commentId: comment.id,
        authorId: owner.id,
        authorName: "Owner",
      }),
    );
    expect(row.title).toBe("You were mentioned");
    expect(row.body).toContain("Release checklist");
    expect(row.body).toContain("Owner mentioned you");
    expect(row.body).toContain("Hi @Member");
    expect(row.attentionMailId).not.toBeNull();
    const letter = await prisma.notificationMail.findUnique({
      where: { id: row.attentionMailId! },
    });
    expect(letter).not.toBeNull();
    expect(JSON.stringify(letter?.message)).not.toContain("Hi @Member");
    // The author is never notified for mentioning themselves.
    expect(await mentionRow(comment.id, owner.id)).toBeNull();

    // The ordinary inbox surface carries the new type and its read path; the
    // card/comment ids are what the bell's deep link composes.
    const page = await server()
      .get(`/api/v1/users/me/notifications?boardId=${boardId}&unreadOnly=true`)
      .set(auth(member.token))
      .expect(200);
    const listed = (
      page.body as { items: Array<{ id: string; type: string }> }
    ).items.find((item) => item.id === row.id);
    expect(listed).toEqual(
      expect.objectContaining({ type: "comment.mention" }),
    );
    const read = await server()
      .post(`/api/v1/users/me/notifications/${row.id}/read`)
      .set(auth(member.token))
      .expect(200);
    expect(read.body.readAt).toEqual(expect.any(Number));
  });

  it("rejects a mention of a user who is not a board member", async () => {
    const before = await prisma.comment.count({ where: { cardId } });

    const response = await createComment(
      `Hello ${mentionMarkdown("Outsider", outsider.id)}`,
    ).expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        code: "mention_not_member",
        field: "text",
        details: expect.objectContaining({ userIds: [outsider.id] }),
      }),
    );
    expect(await prisma.comment.count({ where: { cardId } })).toBe(before);
  });

  it("adds, withdraws and re-adds a mention notification on edits", async () => {
    const created = await createComment("First draft without a ping.").expect(
      201,
    );
    const commentId = (created.body as CommentDto).id;
    expect(await mentionRow(commentId, member.id)).toBeNull();

    const text = `Ping ${mentionMarkdown("Member", member.id)} now.`;
    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .send({ text })
      .expect(200);
    await waitForRow(commentId, member.id);

    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .send({ text: `${text} Edited again.` })
      .expect(200);

    expect(
      await prisma.attentionNotification.count({
        where: { commentId, type: "comment.mention" },
      }),
    ).toBe(1);

    // Removing the token withdraws the row; re-adding it sends a fresh one.
    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .send({ text: "No ping now." })
      .expect(200);
    await waitFor(
      async () => (await mentionRow(commentId, member.id)) === null,
    );

    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .send({ text })
      .expect(200);
    await waitForRow(commentId, member.id);

    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .send({ text: `Hello ${mentionMarkdown("Outsider", outsider.id)}` })
      .expect(400);
  });

  it("does not treat a comment id as a LIKE wildcard during cleanup", async () => {
    const doomed = await createComment(
      `Wildcard ${mentionMarkdown("Member", member.id)}`,
      cardId,
      owner.token,
      "mention_a",
    ).expect(201);
    const survivor = await createComment(
      `Survivor ${mentionMarkdown("Member", member.id)}`,
      cardId,
      owner.token,
      "mentionXa",
    ).expect(201);
    const doomedId = (doomed.body as CommentDto).id;
    const survivorId = (survivor.body as CommentDto).id;
    await waitForRow(doomedId, member.id);
    await waitForRow(survivorId, member.id);

    await server()
      .delete(`/api/v1/comments/${doomedId}`)
      .set(auth(owner.token))
      .expect(200);

    await waitFor(async () => (await mentionRow(doomedId, member.id)) === null);
    expect(await mentionRow(survivorId, member.id)).not.toBeNull();
  });

  it("reconciles the mention diff under the board lock on concurrent edits", async () => {
    const created = await createComment("Concurrent base.").expect(201);
    const commentId = (created.body as CommentDto).id;
    const textA = `A ${mentionMarkdown("Member", member.id)}`;
    const textB = `B ${mentionMarkdown("Erased", erasedAuthor.id)}`;

    await Promise.all([
      server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(owner.token))
        .send({ text: textA })
        .expect(200),
      server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(owner.token))
        .send({ text: textB })
        .expect(200),
    ]);

    const final = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { text: true },
    });
    const expected = extractMentionUserIds(final!.text).sort();
    const rows = await prisma.attentionNotification.findMany({
      where: { commentId, type: "comment.mention" },
      select: { userId: true },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual(expected);
  });

  it("keeps the inbox row but sends no letter after the member opts out", async () => {
    await server()
      .patch("/api/v1/users/me/notification-settings")
      .set(auth(member.token))
      .send({ notifyAttention: false })
      .expect(200);

    const created = await createComment(
      `Opt-out check ${mentionMarkdown("Member", member.id)}`,
    ).expect(201);
    const commentId = (created.body as CommentDto).id;
    const row = await waitForRow(commentId, member.id);

    expect(row.readAt).toBeNull();
    expect(row.attentionMailId).toBeNull();
    // No letter was even staged: the deterministic id the opt-in path would
    // have used does not exist.
    const staged = notificationMailId(
      "attention",
      `comment.mention:${commentId}:${member.id}`,
    );
    expect(
      await prisma.notificationMail.findUnique({ where: { id: staged } }),
    ).toBeNull();

    await server()
      .patch("/api/v1/users/me/notification-settings")
      .set(auth(member.token))
      .send({ notifyAttention: true })
      .expect(200);
  });

  it("removes the mention row when the source comment is deleted", async () => {
    const created = await createComment(
      `Delete me ${mentionMarkdown("Member", member.id)}`,
    ).expect(201);
    const commentId = (created.body as CommentDto).id;
    await waitForRow(commentId, member.id);

    await server()
      .delete(`/api/v1/comments/${commentId}`)
      .set(auth(owner.token))
      .expect(200);

    await waitFor(
      async () =>
        (await prisma.attentionNotification.count({
          where: {
            dedupKey: { startsWith: `comment.mention:${commentId}:` },
          },
        })) === 0,
    );
  });

  it("erases mention rows and letters owned by other recipients on GDPR erase", async () => {
    const created = await createComment(
      `Bye ${mentionMarkdown("Member", member.id)}`,
      cardId,
      erasedAuthor.token,
    ).expect(201);
    const commentId = (created.body as CommentDto).id;
    const row = await waitForRow(commentId, member.id);
    const staged = notificationMailId(
      "attention",
      `comment.mention:${commentId}:${member.id}`,
    );
    expect(
      await prisma.notificationMail.findUnique({ where: { id: staged } }),
    ).not.toBeNull();

    await app.get(AccountDeletionService).deleteAccount(erasedAuthor.id);

    await waitFor(
      async () =>
        (await prisma.attentionNotification.count({ where: { commentId } })) ===
        0,
    );
    expect(await mentionRow(commentId, member.id)).toBeNull();
    expect(
      await prisma.notificationMail.findUnique({ where: { id: staged } }),
    ).toBeNull();
    expect(row.userId).toBe(member.id);
  });

  it("removes mention rows when the board is deleted", async () => {
    const secondBoard = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: "Deleted mentions board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await invite(MEMBER_EMAIL, member.token, secondBoard);
    const secondColumn = randomUUID();
    await command(
      { type: "ADD_COLUMN", newColumnId: secondColumn, title: "Todo" },
      secondBoard,
    );
    const secondCard = await createCard(
      "Doomed card",
      secondBoard,
      secondColumn,
    );
    const created = await createComment(
      `Doomed ${mentionMarkdown("Member", member.id)}`,
      secondCard,
    ).expect(201);
    const commentId = (created.body as CommentDto).id;
    await waitForRow(commentId, member.id);

    await server()
      .delete(`/api/v1/boards/${secondBoard}`)
      .set(auth(owner.token))
      .expect(200);

    await waitFor(
      async () =>
        (await prisma.attentionNotification.count({
          where: {
            boardId: secondBoard,
            type: "comment.mention",
          },
        })) === 0,
    );
  });
});
