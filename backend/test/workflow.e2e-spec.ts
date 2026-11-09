import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { invert } from "@janosik/shared";
import type {
  Board,
  BoardAction,
  BoardWorkflow,
  CommandResponse,
  WorkflowConflictDetails,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "workflow-admin@example.com";
const MEMBER_EMAIL = "workflow-member@example.com";
const VIEWER_EMAIL = "workflow-viewer@example.com";
const PASSWORD = "correct horse battery";

/**
 * Admin-configurable workflow (e2e): configuration command, reference
 * validation, role/condition/transition enforcement inside the board lock,
 * batch atomicity, export/import remapping and the legacy no-workflow path.
 */
describe("Board workflow (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);
    adminToken = await register(ADMIN_EMAIL, "Admin");
    memberToken = await register(MEMBER_EMAIL, "Member");
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let clock = Date.now() - 120_000;
  const tick = () => (clock += 100);
  const scoped = (
    boardId: string,
    body: Record<string, unknown>,
  ): BoardAction =>
    ({ boardId, at: tick(), ...body }) as unknown as BoardAction;

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function invite(
    boardId: string,
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER",
    token: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(adminToken))
      .send({ email, role })
      .expect(201);
    const list = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const invitation = list.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  async function apply(
    boardId: string,
    action: BoardAction,
    token = adminToken,
  ): Promise<CommandResponse> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action })
      .expect(200);
    return res.body as CommandResponse;
  }

  function post(boardId: string, action: BoardAction, token = adminToken) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action });
  }

  async function aggregate(
    boardId: string,
    token = adminToken,
  ): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(token))
      .expect(200);
    return res.body as Board;
  }

  interface Fixture {
    boardId: string;
    backlog: string;
    doing: string;
    done: string;
    cardId: string;
  }

  async function fixture(title: string): Promise<Fixture> {
    const created = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title })
      .expect(201);
    const boardId = created.body.id as string;
    const backlog = randomUUID();
    const doing = randomUUID();
    const done = randomUUID();
    const cardId = randomUUID();
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: backlog,
        title: "Backlog",
      }),
    );
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: doing,
        title: "Doing",
      }),
    );
    await apply(
      boardId,
      scoped(boardId, { type: "ADD_COLUMN", newColumnId: done, title: "Done" }),
    );
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: backlog,
        title: "Task",
      }),
    );
    return { boardId, backlog, doing, done, cardId };
  }

  function workflow(
    ids: Fixture,
    transitions: BoardWorkflow["transitions"] = [
      { id: "backlog-doing", fromColumnId: ids.backlog, toColumnId: ids.doing },
      { id: "doing-backlog", fromColumnId: ids.doing, toColumnId: ids.backlog },
    ],
  ): BoardWorkflow {
    return {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: ids.backlog,
      doneColumnIds: [ids.done],
      transitions,
    };
  }

  function move(
    ids: Fixture,
    toColumnId: string,
    extra: Record<string, unknown> = {},
  ): BoardAction {
    return scoped(ids.boardId, {
      type: "MOVE_CARD",
      cardId: ids.cardId,
      fromColumnId: ids.backlog,
      fromIndex: 0,
      toColumnId,
      toIndex: 0,
      ...extra,
    });
  }

  it("saves a workflow as ADMIN and returns it from the aggregate", async () => {
    const ids = await fixture("Workflow save");
    const config = workflow(ids);
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: config,
      }),
    );
    expect((await aggregate(ids.boardId)).workflow).toEqual(config);
  });

  it("rejects the workflow command for a MEMBER and a VIEWER", async () => {
    const ids = await fixture("Workflow permissions");
    await invite(ids.boardId, MEMBER_EMAIL, "MEMBER", memberToken);
    await invite(ids.boardId, VIEWER_EMAIL, "VIEWER", viewerToken);
    const action = scoped(ids.boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow: workflow(ids),
    });
    await post(ids.boardId, action, memberToken).expect(403);
    await post(ids.boardId, action, viewerToken).expect(403);
  });

  it("allows a configured transition and refuses a missing one with 409 details", async () => {
    const ids = await fixture("Workflow moves");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    await apply(ids.boardId, move(ids, ids.doing));
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.doing,
      )?.cardIds,
    ).toEqual([ids.cardId]);

    // Now from Doing only the reverse edge is configured — Done is forbidden.
    const res = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "MOVE_CARD",
        cardId: ids.cardId,
        fromColumnId: ids.doing,
        fromIndex: 0,
        toColumnId: ids.done,
        toIndex: 0,
      }),
    ).expect(409);
    expect(res.body).toMatchObject({
      conflict: "workflow",
      currentVersion: expect.any(Number),
    });
    const details = res.body.workflow as WorkflowConflictDetails;
    expect(details).toMatchObject({
      code: "transition_not_allowed",
      fromColumnId: ids.doing,
      toColumnId: ids.done,
      allowedToColumnIds: [ids.backlog],
    });
  });

  it("checks conditions and reports the failed ones", async () => {
    const ids = await fixture("Workflow conditions");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "backlog-doing",
            fromColumnId: ids.backlog,
            toColumnId: ids.doing,
            conditions: ["requireAssignee", "requireDescription"],
          },
        ]),
      }),
    );
    const res = await post(ids.boardId, move(ids, ids.doing)).expect(409);
    expect(
      (res.body.workflow as WorkflowConflictDetails).failedConditions,
    ).toEqual(["requireAssignee", "requireDescription"]);

    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_CARD_ASSIGN",
        cardId: ids.cardId,
        assigneeId: (
          await server().get("/api/v1/auth/me").set(auth(adminToken))
        ).body.id,
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "UPDATE_CARD",
        cardId: ids.cardId,
        description: "Ready",
      }),
    );
    await apply(ids.boardId, move(ids, ids.doing));
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.doing,
      )?.cardIds,
    ).toEqual([ids.cardId]);
  });

  it("checks all four card conditions and clears them one field at a time", async () => {
    const ids = await fixture("Workflow all conditions");
    const checklistId = randomUUID();
    const itemId = randomUUID();
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "backlog-doing",
            fromColumnId: ids.backlog,
            toColumnId: ids.doing,
            conditions: [
              "requireAssignee",
              "requireDueDate",
              "requireDescription",
              "requireChecklistsDone",
            ],
          },
        ]),
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "ADD_CHECKLIST",
        cardId: ids.cardId,
        newChecklistId: checklistId,
        title: "DoD",
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: ids.cardId,
        checklistId,
        newItemId: itemId,
        text: "Ship it",
      }),
    );

    const first = await post(ids.boardId, move(ids, ids.doing)).expect(409);
    expect(first.body.workflow.failedConditions).toEqual([
      "requireAssignee",
      "requireDueDate",
      "requireDescription",
      "requireChecklistsDone",
    ]);

    const me = (await server().get("/api/v1/auth/me").set(auth(adminToken)))
      .body.id as string;
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_CARD_ASSIGN",
        cardId: ids.cardId,
        assigneeId: me,
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "UPDATE_CARD",
        cardId: ids.cardId,
        description: "Ready",
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_CARD_DUE_DATE",
        cardId: ids.cardId,
        dueDate: Date.now() + 86_400_000,
      }),
    );
    const onlyChecklist = await post(ids.boardId, move(ids, ids.doing)).expect(
      409,
    );
    expect(onlyChecklist.body.workflow.failedConditions).toEqual([
      "requireChecklistsDone",
    ]);

    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: ids.cardId,
        checklistId,
        itemId,
        done: true,
      }),
    );
    await apply(ids.boardId, move(ids, ids.doing));
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.doing,
      )?.cardIds,
    ).toEqual([ids.cardId]);
  });

  it("undoes a workflow save through the same command path", async () => {
    const ids = await fixture("Workflow undo");
    const first = workflow(ids);
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: first,
      }),
    );
    const before = await aggregate(ids.boardId);
    const second = workflow(ids, [
      { id: "backlog-done", fromColumnId: ids.backlog, toColumnId: ids.done },
    ]);
    const action = scoped(ids.boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow: second,
    });
    await apply(ids.boardId, action);
    expect((await aggregate(ids.boardId)).workflow).toEqual(second);

    const inverse = invert(before, action);
    expect(inverse?.type).toBe("SET_BOARD_WORKFLOW");
    await apply(ids.boardId, inverse!);
    expect((await aggregate(ids.boardId)).workflow).toEqual(first);
  });

  it("enforces role-restricted global transitions", async () => {
    const ids = await fixture("Workflow roles");
    await invite(ids.boardId, MEMBER_EMAIL, "MEMBER", memberToken);
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "any-done",
            fromColumnId: null,
            toColumnId: ids.done,
            allowedRoles: ["ADMIN"],
          },
        ]),
      }),
    );
    const res = await post(
      ids.boardId,
      move(ids, ids.done),
      memberToken,
    ).expect(409);
    expect(res.body.workflow).toMatchObject({
      code: "role_not_allowed",
      requiredRoles: ["ADMIN"],
      allowedToColumnIds: [],
    });
    await apply(ids.boardId, move(ids, ids.done));
  });

  it("rejects an enabled workflow whose transitions are all disabled", async () => {
    const ids = await fixture("Workflow no active edge");
    const res = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "backlog-doing",
            fromColumnId: ids.backlog,
            toColumnId: ids.doing,
            enabled: false,
          },
        ]),
      }),
    ).expect(400);
    expect(res.body.field).toBe("action.workflow.transitions");
    expect(String(res.body.message)).toContain("active transition");
    expect((await aggregate(ids.boardId)).workflow).toBeUndefined();
  });

  it("enforces the workflow when a MEMBER unarchives a card", async () => {
    const ids = await fixture("Workflow unarchive bypass");
    await invite(ids.boardId, MEMBER_EMAIL, "MEMBER", memberToken);
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, { type: "ARCHIVE_CARD", cardId: ids.cardId }),
      memberToken,
    );
    expect((await aggregate(ids.boardId)).cards[ids.cardId].archivedAt).toEqual(
      expect.any(Number),
    );

    const denied = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "UNARCHIVE_CARD",
        cardId: ids.cardId,
        columnId: ids.done,
      }),
      memberToken,
    ).expect(409);
    expect(denied.body.workflow).toMatchObject({
      code: "transition_not_allowed",
      fromColumnId: ids.backlog,
      toColumnId: ids.done,
      allowedToColumnIds: [ids.doing],
    });
    // Still archived: the refused command changed nothing.
    expect((await aggregate(ids.boardId)).cards[ids.cardId].archivedAt).toEqual(
      expect.any(Number),
    );

    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "UNARCHIVE_CARD",
        cardId: ids.cardId,
        columnId: ids.backlog,
      }),
      memberToken,
    );
    const after = await aggregate(ids.boardId);
    expect(after.cards[ids.cardId].archivedAt).toBeUndefined();
    expect(
      after.columns.find((column) => column.id === ids.backlog)?.cardIds,
    ).toContain(ids.cardId);
  });

  it("enforces the workflow when RESTORE_CARD recreates a deleted card", async () => {
    const ids = await fixture("Workflow restore bypass");
    await invite(ids.boardId, MEMBER_EMAIL, "MEMBER", memberToken);
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    const beforeDelete = await aggregate(ids.boardId);
    const snapshot = beforeDelete.cards[ids.cardId];
    await apply(
      ids.boardId,
      scoped(ids.boardId, { type: "DELETE_CARD", cardId: ids.cardId }),
      memberToken,
    );

    const denied = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "RESTORE_CARD",
        card: snapshot,
        columnId: ids.done,
        index: 0,
      }),
      memberToken,
    ).expect(409);
    expect(denied.body.workflow).toMatchObject({
      code: "transition_not_allowed",
      fromColumnId: ids.backlog,
      toColumnId: ids.done,
    });

    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "RESTORE_CARD",
        card: snapshot,
        columnId: ids.backlog,
        index: 0,
      }),
      memberToken,
    );
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.backlog,
      )?.cardIds,
    ).toContain(ids.cardId);
  });

  it("reports workflow before WIP when both would refuse a move", async () => {
    const ids = await fixture("Workflow wip order");
    const blocker = randomUUID();
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "ADD_CARD",
        newCardId: blocker,
        columnId: ids.done,
        title: "Already done",
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_COLUMN_WIP_LIMIT",
        columnId: ids.done,
        wipLimit: 1,
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "backlog-done",
            fromColumnId: ids.backlog,
            toColumnId: ids.done,
          },
        ]),
      }),
    );

    const allowedByWorkflow = await post(
      ids.boardId,
      move(ids, ids.done),
    ).expect(409);
    expect(allowedByWorkflow.body.conflict).toBe("wip");

    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "backlog-doing",
            fromColumnId: ids.backlog,
            toColumnId: ids.doing,
          },
        ]),
      }),
    );
    const deniedByWorkflow = await post(
      ids.boardId,
      move(ids, ids.done),
    ).expect(409);
    expect(deniedByWorkflow.body.conflict).toBe("workflow");
    expect(deniedByWorkflow.body.workflow.code).toBe("transition_not_allowed");
  });

  it("answers a stale source with a version conflict on a workflow board", async () => {
    const ids = await fixture("Workflow stale source");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    const res = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "MOVE_CARD",
        cardId: ids.cardId,
        fromColumnId: ids.doing,
        fromIndex: 0,
        toColumnId: ids.done,
        toIndex: 0,
      }),
    ).expect(409);
    expect(res.body).toMatchObject({
      conflict: "version",
      currentVersion: expect.any(Number),
    });
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.backlog,
      )?.cardIds,
    ).toEqual([ids.cardId]);
  });

  it("fails closed when the stored workflow is invalid or from the future", async () => {
    const ids = await fixture("Workflow invalid stored");
    await prisma.board.update({
      where: { id: ids.boardId },
      data: {
        workflow: {
          schemaVersion: 2,
          enabled: true,
          doneColumnIds: [],
          transitions: [],
        },
      },
    });
    const board = await aggregate(ids.boardId);
    expect(board.workflowInvalid).toBe(true);
    expect(board.workflow).toMatchObject({ enabled: true, transitions: [] });

    const res = await post(ids.boardId, move(ids, ids.done)).expect(409);
    expect(res.body.workflow.code).toBe("transition_not_allowed");
    expect(res.body.workflow.allowedToColumnIds).toEqual([]);
  });

  it("rejects a workflow that references a missing column", async () => {
    const ids = await fixture("Workflow dangling");
    const res = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids, [
          {
            id: "bad",
            fromColumnId: ids.backlog,
            toColumnId: "missing-column",
          },
        ]),
      }),
    ).expect(400);
    expect(res.body.field).toBe("action.workflow.transitions[0].toColumnId");
  });

  it("keeps legacy boards unrestricted", async () => {
    const ids = await fixture("Workflow legacy");
    await apply(ids.boardId, move(ids, ids.done));
    expect(
      (await aggregate(ids.boardId)).columns.find(
        (column) => column.id === ids.done,
      )?.cardIds,
    ).toEqual([ids.cardId]);
  });

  it("applies workflow checks to inverse moves too", async () => {
    const ids = await fixture("Workflow inverse");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    await apply(ids.boardId, move(ids, ids.doing));
    const res = await post(
      ids.boardId,
      scoped(ids.boardId, {
        type: "MOVE_CARD",
        cardId: ids.cardId,
        fromColumnId: ids.doing,
        fromIndex: 0,
        toColumnId: ids.done,
        toIndex: 0,
        inverse: true,
      }),
    ).expect(409);
    expect((res.body.workflow as WorkflowConflictDetails).code).toBe(
      "transition_not_allowed",
    );
  });

  it("rolls a batch back when one move is forbidden", async () => {
    const ids = await fixture("Workflow batch");
    const secondCard = randomUUID();
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "ADD_CARD",
        newCardId: secondCard,
        columnId: ids.backlog,
        title: "Second",
      }),
    );
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    const res = await server()
      .post(`/api/v1/boards/${ids.boardId}/commands/batch`)
      .set(auth(adminToken))
      .send({
        commands: [
          {
            commandId: randomUUID(),
            action: move(ids, ids.doing),
          },
          {
            commandId: randomUUID(),
            action: scoped(ids.boardId, {
              type: "MOVE_CARD",
              cardId: secondCard,
              fromColumnId: ids.backlog,
              fromIndex: 1,
              toColumnId: ids.done,
              toIndex: 0,
            }),
          },
        ],
      })
      .expect(409);
    expect(res.body.conflict).toBe("workflow");
    const after = await aggregate(ids.boardId);
    expect(
      after.columns.find((column) => column.id === ids.backlog)?.cardIds,
    ).toEqual([ids.cardId, secondCard]);
  });

  it("round-trips the workflow through export and import with fresh ids", async () => {
    const ids = await fixture("Workflow export");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    const exported = await server()
      .get(`/api/v1/boards/${ids.boardId}/export`)
      .set(auth(adminToken))
      .expect(200);
    expect(exported.body.schemaVersion).toBe(2);
    const envelope = exported.body;

    const imported = await server()
      .post("/api/v1/boards/import")
      .set(auth(adminToken))
      .send(envelope)
      .expect(201);
    const importedId = (imported.body as Array<{ id: string }>)[0].id;
    const board = await aggregate(importedId);
    expect(board.id).not.toBe(ids.boardId);
    expect(board.workflow?.enabled).toBe(true);
    expect(board.workflow?.transitions).toHaveLength(2);
    const backlog = board.columns.find((column) => column.title === "Backlog");
    const doing = board.columns.find((column) => column.title === "Doing");
    expect(board.workflow?.transitions[0]).toMatchObject({
      fromColumnId: backlog?.id,
      toColumnId: doing?.id,
    });
    expect(board.workflow?.initialColumnId).toBe(backlog?.id);
  });

  it("serves the workflow read-only through a public share", async () => {
    const ids = await fixture("Workflow share");
    await apply(
      ids.boardId,
      scoped(ids.boardId, {
        type: "SET_BOARD_WORKFLOW",
        workflow: workflow(ids),
      }),
    );
    const share = await server()
      .post(`/api/v1/boards/${ids.boardId}/shares`)
      .set(auth(adminToken))
      .send({ mode: "live" })
      .expect(201);
    const publicBoard = await server()
      .get(`/api/v1/share/${share.body.token}`)
      .expect(200);
    expect(publicBoard.body.board.workflow).toMatchObject({
      enabled: true,
      transitions: expect.arrayContaining([
        expect.objectContaining({ fromColumnId: ids.backlog }),
      ]),
    });
  });
});
