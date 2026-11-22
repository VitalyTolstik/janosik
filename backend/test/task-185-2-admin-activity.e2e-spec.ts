import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { argon2id, hash as argonHash } from "argon2";
import type { BoardAction } from "@janosik/shared";

import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "1852-admin@example.com";
const ADMIN_PASSWORD = "1852 admin password";
const USER_EMAIL = "1852-author@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-185.2 admin projection: deleting a comment must remove its edits from
 * the raw Activity list, user detail and card timeline before pagination; the
 * surviving add/delete tombstones carry no body, changes or raw details.
 */
describe("Admin comment activity projection (TASK-185.2, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let userId: string;
  let boardId: string;
  let cardId: string;
  let commentId: string;

  const server = () => request(app.getHttpServer());
  const admin = (path: string) =>
    server().get(path).set("Authorization", `Bearer ${adminToken}`);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    adminToken = (
      await server()
        .post("/api/v1/admin/auth/login")
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: USER_EMAIL, password: PASSWORD, displayName: "Author" })
      .expect(201);
    userToken = registered.body.accessToken as string;
    userId = registered.body.user.id as string;

    boardId = (
      await server()
        .post("/api/v1/boards")
        .set(auth(userToken))
        .send({ title: "Admin projection" })
        .expect(201)
    ).body.id as string;
    const command = async (action: Record<string, unknown>) =>
      server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth(userToken))
        .send({
          commandId: randomUUID(),
          action: { boardId, at: Date.now(), ...action } as BoardAction,
        })
        .expect(200);
    await command({ type: "ADD_COLUMN", newColumnId: "col-1", title: "Todo" });
    cardId = "card-1";
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-1",
      title: "Card",
    });

    commentId = (
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(userToken))
        .send({ text: "Original private body" })
        .expect(201)
    ).body.id as string;
    await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(userToken))
      .send({ text: "Edited private body" })
      .expect(200);
    await server()
      .delete(`/api/v1/comments/${commentId}`)
      .set(auth(userToken))
      .expect(200);
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  it("filters the deleted edit before paging and hides every comment body", async () => {
    const res = await admin(
      `/api/v1/admin/entities/activity?boardId=${boardId}` +
        "&type=comment_added&type=comment_updated&type=comment_deleted&limit=50",
    ).expect(200);
    const page = res.body as {
      items: Array<{
        id: string;
        type: string;
        details: unknown;
      }>;
      total: number;
    };
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.type).sort()).toEqual([
      "comment_added",
      "comment_deleted",
    ]);
    expect(page.items.every((item) => item.details === null)).toBe(true);
    const json = JSON.stringify(page);
    expect(json).not.toContain("Original private body");
    expect(json).not.toContain("Edited private body");

    // Filtering happens before paging: two one-row pages still total two and
    // the deleted edit never occupies a slot at either offset.
    const base =
      `/api/v1/admin/entities/activity?boardId=${boardId}` +
      "&type=comment_added&type=comment_updated&type=comment_deleted";
    const first = await admin(`${base}&limit=1&offset=0`).expect(200);
    const second = await admin(`${base}&limit=1&offset=1`).expect(200);
    expect(first.body.total).toBe(2);
    expect(second.body.total).toBe(2);
    expect(first.body.items).toHaveLength(1);
    expect(second.body.items).toHaveLength(1);
    expect(
      [
        ...first.body.items.map((item: { type: string }) => item.type),
        ...second.body.items.map((item: { type: string }) => item.type),
      ].sort(),
    ).toEqual(["comment_added", "comment_deleted"]);
    expect(JSON.stringify([first.body, second.body])).not.toContain(
      "Edited private body",
    );
  });

  it("projects the user activity tab without deleted text or details", async () => {
    const res = await admin(
      `/api/v1/admin/users/${userId}/detail?section=activity&limit=50`,
    ).expect(200);
    const body = res.body as {
      recentActivity: Array<{ type: string; details: unknown }>;
      windows: { activity: { total: number } };
    };
    expect(body.windows.activity.total).toBe(2);
    const comments = body.recentActivity.filter((row) =>
      row.type.startsWith("comment_"),
    );
    expect(comments.map((row) => row.type).sort()).toEqual([
      "comment_added",
      "comment_deleted",
    ]);
    expect(comments.every((row) => row.details === null)).toBe(true);
    const json = JSON.stringify(body.recentActivity);
    expect(json).not.toContain("Original private body");
    expect(json).not.toContain("Edited private body");
  });

  it("projects the card timeline without the deleted edit or its body", async () => {
    const res = await admin(
      `/api/v1/admin/cards/${cardId}/detail?section=timeline&limit=50`,
    ).expect(200);
    const body = res.body as {
      timeline: Array<{ id: string; type: string; details: unknown }>;
    };
    const comments = body.timeline.filter((row) =>
      row.type.startsWith("comment_"),
    );
    expect(comments.map((row) => row.type).sort()).toEqual([
      "comment_added",
      "comment_deleted",
    ]);
    expect(comments.every((row) => row.details === null)).toBe(true);
    const json = JSON.stringify(body.timeline);
    expect(json).not.toContain("Original private body");
    expect(json).not.toContain("Edited private body");
  });
});
