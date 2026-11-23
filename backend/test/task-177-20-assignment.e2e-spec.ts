import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { AttentionNotificationDto } from "@janosik/shared";

import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "assign-owner@example.com";
const MEMBER_EMAIL = "assign-member@example.com";
const SECOND_EMAIL = "assign-second@example.com";
const QUIET_EMAIL = "assign-quiet@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-177.20.3a — assignment attention over HTTP.
 *
 * The suite pins the post-commit hook: one row per assignee per batch, last
 * assignment per card wins, unassign/archive/no-op/replay produce nothing,
 * self-assignment is skipped, and `notifyAttention` only suppresses the
 * letter. The inbox route is exercised as the browser sees it.
 */
describe("Card assignment attention (TASK-177.20, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let owner: { token: string; id: string };
  let member: { token: string; id: string };
  let second: { token: string; id: string };
  let quiet: { token: string; id: string };
  let boardId: string;
  const cards = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);
    await wipeAll(prisma);

    owner = await register(OWNER_EMAIL, "Owner");
    member = await register(MEMBER_EMAIL, "Member");
    second = await register(SECOND_EMAIL, "Second");
    quiet = await register(QUIET_EMAIL, "Quiet");

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: "Assignments" })
      .expect(201)
      .then((response) => response.body.id as string);
    await invite(MEMBER_EMAIL, member.token);
    await invite(SECOND_EMAIL, second.token);
    await invite(QUIET_EMAIL, quiet.token);
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });

    const titles: Array<[string, string]> = [
      ["c1", "Ship release"],
      ["c2", "Self card"],
      ["c3", "Transient"],
      ["c4", "Archived assign"],
      ["c5", "Contested"],
      ["c6", "Batch one"],
      ["c7", "Batch two"],
      ["c8", "Batch three"],
      ["c9", "Batch four"],
      ["c10", "Batch five"],
      ["c11", "Quiet card"],
    ];
    for (const [key, title] of titles) {
      cards.set(key, await createCard(title));
    }

    await server()
      .patch("/api/v1/users/me/notification-settings")
      .set(auth(quiet.token))
      .send({ notifyAttention: false })
      .expect(200);
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

  async function invite(email: string, inviteeSession: string): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(owner.token))
      .send({ email, role: "MEMBER" })
      .expect(201);
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(inviteeSession))
      .expect(200)
      .then(
        (response) =>
          (response.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === boardId,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(inviteeSession))
      .expect(200);
  }

  function commandOf(action: Record<string, unknown>) {
    return {
      commandId: randomUUID(),
      action: { boardId, at: Date.now(), ...action },
    };
  }

  async function command(action: Record<string, unknown>): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(owner.token))
      .send(commandOf(action))
      .expect(200);
  }

  async function batch(
    commands: Array<Record<string, unknown>>,
  ): Promise<AttentionNotificationDto[]> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(owner.token))
      .send({ commands })
      .expect(200);
    return rows();
  }

  async function createCard(title: string): Promise<string> {
    const cardId = randomUUID();
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-1",
      title,
    });
    return cardId;
  }

  function assign(cardId: string, assigneeId: string | null) {
    return commandOf({ type: "SET_CARD_ASSIGN", cardId, assigneeId });
  }

  function rows(): Promise<AttentionNotificationDto[]> {
    return prisma.attentionNotification
      .findMany({
        where: { type: "card.assigned", boardId },
        orderBy: { createdAt: "asc" },
      })
      .then((found) =>
        found.map((row) => ({
          id: row.id,
          type: "card.assigned",
          boardId: row.boardId,
          title: row.title,
          body: row.body,
          data: (row.data as Record<string, unknown> | null) ?? null,
          readAt: row.readAt?.getTime() ?? null,
          createdAt: row.createdAt.getTime(),
        })),
      );
  }

  function dataOf(row: AttentionNotificationDto): {
    assigneeId: string;
    cardIds: string[];
    cardId?: string;
  } {
    return row.data as {
      assigneeId: string;
      cardIds: string[];
      cardId?: string;
    };
  }

  async function waitForMail(to: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const found = mailer.outbox.find(
        (mail) =>
          mail.to === to && mail.subject.includes("new card assignment"),
      );
      if (found !== undefined) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`assignment e2e: no letter to ${to}`);
  }

  it("notifies the new assignee once and exposes the row to the inbox", async () => {
    await command({
      type: "SET_CARD_ASSIGN",
      cardId: cards.get("c1"),
      assigneeId: member.id,
    });

    const assigned = await rows();
    const row = assigned.find(
      (candidate) => dataOf(candidate).cardId === cards.get("c1"),
    );
    expect(row).toBeDefined();
    expect(dataOf(row!)).toEqual({
      assigneeId: member.id,
      cardIds: [cards.get("c1")],
      cardId: cards.get("c1"),
      actorName: "Owner",
    });
    expect(row!.body).toContain("Ship release");
    expect(row!.body).toContain("Owner");
    await waitForMail(MEMBER_EMAIL);

    const inbox = await server()
      .get("/api/v1/users/me/notifications")
      .set(auth(member.token))
      .expect(200)
      .then(
        (response) => response.body as { items: AttentionNotificationDto[] },
      );
    expect(
      inbox.items.some(
        (item) =>
          item.type === "card.assigned" &&
          (item.data as { cardId?: string }).cardId === cards.get("c1"),
      ),
    ).toBe(true);
  });

  it("skips self-assignment, a trailing unassign and an archived card", async () => {
    await batch([assign(cards.get("c2")!, owner.id)]);
    await batch([
      assign(cards.get("c3")!, member.id),
      assign(cards.get("c3")!, null),
    ]);
    await batch([
      assign(cards.get("c4")!, member.id),
      commandOf({ type: "ARCHIVE_CARD", cardId: cards.get("c4") }),
    ]);

    const assigned = await rows();
    const touched = new Set([
      cards.get("c2"),
      cards.get("c3"),
      cards.get("c4"),
    ]);
    expect(
      assigned.filter((row) =>
        dataOf(row).cardIds.some((cardId) => touched.has(cardId)),
      ),
    ).toEqual([]);
  });

  it("coalesces a batch, keeps the last assignee per card, and is replay-safe", async () => {
    const commands = [
      assign(cards.get("c5")!, member.id),
      assign(cards.get("c5")!, second.id),
      assign(cards.get("c6")!, member.id),
      assign(cards.get("c7")!, member.id),
      assign(cards.get("c8")!, member.id),
      assign(cards.get("c9")!, member.id),
      assign(cards.get("c10")!, member.id),
    ];
    const afterFirst = await batch(commands);

    const batchCards = new Set([
      cards.get("c5"),
      cards.get("c6"),
      cards.get("c7"),
      cards.get("c8"),
      cards.get("c9"),
      cards.get("c10"),
    ]);
    const inBatch = afterFirst.filter((row) =>
      dataOf(row).cardIds.some((cardId) => batchCards.has(cardId)),
    );
    const memberRows = inBatch.filter(
      (row) => dataOf(row).assigneeId === member.id,
    );
    const secondRows = inBatch.filter(
      (row) => dataOf(row).assigneeId === second.id,
    );
    expect(memberRows).toHaveLength(1);
    expect(new Set(dataOf(memberRows[0]!).cardIds)).toEqual(
      new Set([
        cards.get("c6"),
        cards.get("c7"),
        cards.get("c8"),
        cards.get("c9"),
        cards.get("c10"),
      ]),
    );
    expect(dataOf(memberRows[0]!).cardId).toBeUndefined();
    expect(memberRows[0]!.body).toContain("Batch three");
    expect(memberRows[0]!.body).toContain("and 2 more");
    expect(secondRows).toHaveLength(1);
    expect(dataOf(secondRows[0]!)).toEqual({
      assigneeId: second.id,
      cardIds: [cards.get("c5")],
      cardId: cards.get("c5"),
      actorName: "Owner",
    });
    expect(
      inBatch.some(
        (row) =>
          dataOf(row).assigneeId === member.id &&
          dataOf(row).cardId === cards.get("c5"),
      ),
    ).toBe(false);

    const replayed = await batch(commands);
    expect(replayed).toHaveLength(afterFirst.length);
  });

  it("keeps an opted-out assignee's inbox row but sends no letter", async () => {
    await batch([assign(cards.get("c11")!, quiet.id)]);

    const row = (await rows()).find(
      (candidate) => dataOf(candidate).cardId === cards.get("c11"),
    );
    expect(row).toBeDefined();
    expect(dataOf(row!).assigneeId).toBe(quiet.id);
    expect(
      mailer.outbox.some(
        (mail) =>
          mail.to === QUIET_EMAIL &&
          mail.subject.includes("new card assignment"),
      ),
    ).toBe(false);
  });
});
