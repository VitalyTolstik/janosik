import { describe, expect, it } from "vitest";

import { boardEpicProgress, epicOf } from "./epics";
import { boardReducer, type BoardAction } from "./store/board-reducer";
import { invert } from "./store/invert";
import { normalizeBoards } from "./store/migrate";
import { validateBoardAction } from "./store/validate";
import type { Board, Epic } from "./types/kanban";
import { LIMITS } from "./types/kanban";
import { parseExport, serializeExport } from "./utils/board-serialization";

const epic: Epic = {
  id: "release",
  title: "Release",
  color: "rose",
  status: "active",
  position: 0,
  createdAt: 1,
  updatedAt: 1,
};
const addEpic: BoardAction = { type: "ADD_EPIC", epic, at: 2 };

function fixture(): Board {
  const card = {
    id: "card",
    title: "Ship it",
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    id: "board",
    title: "Board",
    cards: { card },
    columns: [
      { id: "backlog", title: "Backlog", cardIds: ["card"], createdAt: 1 },
      { id: "done", title: "Done", cardIds: [], createdAt: 1 },
    ],
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function reduce(board: Board, action: BoardAction): Board {
  return boardReducer([board], action)[0];
}

function assertUndo(before: Board, action: BoardAction): Board {
  const validated = validateBoardAction(action);
  if (!validated.ok) throw new Error(validated.field);
  const after = reduce(before, validated.action);
  expect(after).not.toBe(before);
  const inverse = validateBoardAction(invert(before, validated.action));
  if (!inverse.ok) throw new Error(inverse.field);
  expect(reduce(after, inverse.action)).toStrictEqual(before);
  return after;
}

describe("epic commands", () => {
  it("round-trips all six actions through wire validation and undo", () => {
    const before = fixture();
    const added = assertUndo(before, addEpic);
    assertUndo({ ...before, epics: [] }, addEpic);
    const updated = assertUndo(added, {
      type: "UPDATE_EPIC",
      epicId: epic.id,
      title: "  Release v2  ",
      ownerId: "member",
      description: "Notes",
      startDate: 0,
      dueDate: 100,
      at: 3,
    });
    expect(epicOf(updated, epic.id)).toMatchObject({
      title: "Release v2",
      startDate: 0,
      updatedAt: 3,
    });
    const complete = assertUndo(updated, {
      type: "SET_EPIC_STATUS",
      epicId: epic.id,
      status: "completed",
      at: 4,
    });
    expect(epicOf(complete, epic.id)?.completedAt).toBe(4);
    const reopened = assertUndo(complete, {
      type: "SET_EPIC_STATUS",
      epicId: epic.id,
      status: "active",
      at: 5,
    });
    expect(epicOf(reopened, epic.id)).not.toHaveProperty("completedAt");

    const assigned = assertUndo(reopened, {
      type: "SET_CARD_EPIC",
      cardId: "card",
      epicId: epic.id,
      at: 6,
    });
    expect(assigned.cards.card.activity?.at(-1)).toMatchObject({
      type: "epic-set",
      detail: "Release v2",
      at: 6,
    });
    const deletion: BoardAction = {
      type: "DELETE_EPIC",
      epicId: epic.id,
      at: 7,
    };
    const deleted = assertUndo(assigned, deletion);
    expect(deleted.cards).toBe(assigned.cards);
    expect(epicOf(deleted, deleted.cards.card.epicId)).toBeUndefined();
    expect(normalizeBoards([deleted])[0].cards.card.epicId).toBe(epic.id);
    const restore = invert(assigned, deletion)!;
    expect(assertUndo(deleted, restore)).toStrictEqual(assigned);
    const cleared = assertUndo(deleted, {
      type: "SET_CARD_EPIC",
      cardId: "card",
      epicId: null,
      at: 8,
    });
    expect(reduce(cleared, restore).cards.card.epicId).toBeUndefined();
  });

  it("adds and moves with absolute membership while pure moves keep it", () => {
    const added = assertUndo(reduce(fixture(), addEpic), {
      type: "ADD_CARD",
      newCardId: "new",
      columnId: "backlog",
      title: "Subtask",
      epicId: epic.id,
      at: 3,
    });
    const moved = assertUndo(added, {
      type: "MOVE_CARD",
      cardId: "new",
      fromColumnId: "backlog",
      fromIndex: 1,
      toColumnId: "done",
      toIndex: 0,
      at: 4,
    });
    expect(moved.cards.new).toMatchObject({ epicId: epic.id, updatedAt: 3 });
    expect(boardEpicProgress(moved).get(epic.id)).toEqual({
      total: 1,
      done: 1,
      open: 0,
    });
    const cleared = assertUndo(moved, {
      type: "MOVE_CARD",
      cardId: "new",
      fromColumnId: "done",
      fromIndex: 0,
      toColumnId: "done",
      toIndex: 0,
      epicId: null,
      at: 5,
    });
    expect(cleared.columns).toBe(moved.columns);
    expect(cleared.cards.new.epicId).toBeUndefined();
    expect(cleared.cards.new.activity?.at(-1)).toMatchObject({
      type: "epic-removed",
      detail: "Release",
    });
  });

  it("clamps local text and ignores duplicate ids, no-op edits and invalid assignments", () => {
    const board = reduce(fixture(), {
      ...addEpic,
      epic: {
        ...epic,
        title: ` ${"a".repeat(201)} `,
        description: "b".repeat(10_001),
      },
    });
    expect(board.epics?.[0].title).toHaveLength(LIMITS.epicTitle);
    expect(board.epics?.[0].description).toHaveLength(LIMITS.epicDescription);
    expect(reduce(board, addEpic)).toBe(board);
    expect(
      reduce(board, {
        type: "UPDATE_EPIC",
        epicId: epic.id,
        title: board.epics![0].title,
        at: 3,
      }),
    ).toBe(board);
    const atLimit = {
      ...board,
      epics: Array.from({ length: LIMITS.epicsPerBoard }, (_, position) => ({
        ...epic,
        id: `epic-${position}`,
        position,
      })),
    };
    expect(reduce(atLimit, addEpic)).toBe(atLimit);
    expect(
      reduce(board, {
        type: "SET_CARD_EPIC",
        cardId: "card",
        epicId: "missing",
        at: 3,
      }),
    ).toBe(board);
    const completed = reduce(board, {
      type: "SET_EPIC_STATUS",
      epicId: epic.id,
      status: "completed",
      at: 3,
    });
    expect(
      reduce(completed, {
        type: "SET_CARD_EPIC",
        cardId: "card",
        epicId: epic.id,
        at: 4,
      }),
    ).toBe(completed);
  });

  it("rejects invalid shapes, oversized data, and fresh restores", () => {
    const cases = [
      [{ ...addEpic, epic: { ...epic, id: "__proto__" } }, "action.epic.id"],
      [
        { ...addEpic, epic: { ...epic, title: "x".repeat(201) } },
        "action.epic.title",
      ],
      [{ ...addEpic, epic: { ...epic, color: "green" } }, "action.epic.color"],
      [
        {
          type: "UPDATE_EPIC",
          epicId: epic.id,
          description: "x".repeat(10_001),
          at: 3,
        },
        "action.description",
      ],
      [
        { type: "UPDATE_EPIC", epicId: epic.id, startDate: Infinity, at: 3 },
        "action.startDate",
      ],
      [
        { type: "SET_EPIC_STATUS", epicId: epic.id, status: "draft", at: 3 },
        "action.status",
      ],
      [{ type: "RESTORE_EPIC", epic, index: 0, at: 3 }, "action.inverse"],
      [{ type: "SET_CARD_EPIC", cardId: "card", at: 3 }, "action.epicId"],
    ];
    for (const [action, field] of cases) {
      expect(validateBoardAction(action)).toMatchObject({ ok: false, field });
    }
  });

  it("copies valid membership on card and column duplication and drops deleted links", () => {
    const board = reduce(reduce(fixture(), addEpic), {
      type: "SET_CARD_EPIC",
      cardId: "card",
      epicId: epic.id,
      at: 3,
    });
    const duplicateCard = {
      type: "DUPLICATE_CARD",
      cardId: "card",
      newCardId: "copy",
      at: 4,
    } as const;
    const duplicateColumn: BoardAction = {
      type: "DUPLICATE_COLUMN",
      columnId: "backlog",
      newColumnId: "copy-column",
      newCardIds: ["copy"],
      at: 4,
    };
    for (const action of [duplicateCard, duplicateColumn]) {
      expect(reduce(board, action).cards.copy.epicId).toBe(epic.id);
      const deleted = reduce(board, {
        type: "DELETE_EPIC",
        epicId: epic.id,
        at: 3,
      });
      expect(reduce(deleted, action).cards.copy.epicId).toBeUndefined();
    }
  });
});

describe("epic progress and export", () => {
  it("counts configured done columns and skips archived, unplaced and missing cards", () => {
    const board = reduce(fixture(), addEpic);
    const card = { ...board.cards.card, epicId: epic.id };
    board.cards = {
      card,
      archived: { ...card, id: "archived", archivedAt: 5 },
      unplaced: { ...card, id: "unplaced" },
      done: { ...card, id: "done" },
    };
    board.columns[1].cardIds = ["done", "archived", "missing"];
    const empty = { ...epic, id: "empty", position: 1 };
    board.epics!.push(empty);
    expect(boardEpicProgress(board).get(epic.id)).toEqual({
      total: 2,
      done: 1,
      open: 1,
    });
    expect(boardEpicProgress(board).get(empty.id)).toEqual({
      total: 0,
      done: 0,
      open: 0,
    });
    board.workflow = {
      schemaVersion: 1,
      enabled: true,
      doneColumnIds: ["missing", "backlog", "done"],
      transitions: [],
    };
    expect(boardEpicProgress(board).get(epic.id)).toEqual({
      total: 2,
      done: 2,
      open: 0,
    });
  });

  it("round-trips v4 data, trims fields and drops unknown and dangling membership", () => {
    const board = reduce(reduce(fixture(), addEpic), {
      type: "SET_CARD_EPIC",
      cardId: "card",
      epicId: epic.id,
      at: 3,
    });
    expect(parseExport(serializeExport([board]))).toStrictEqual([board]);
    const deleted = reduce(board, {
      type: "DELETE_EPIC",
      epicId: epic.id,
      at: 4,
    });
    expect(
      parseExport(serializeExport([deleted]))[0].cards.card,
    ).not.toHaveProperty("epicId");
    expect(deleted.cards.card.epicId).toBe(epic.id);
    const raw = JSON.parse(serializeExport([board]));
    raw.boards[0].cards.card.epicId = "another-board";
    raw.boards[0].epics[0] = {
      ...epic,
      position: undefined,
      title: ` ${"a".repeat(201)} `,
      unknown: true,
    };
    const parsed = parseExport(JSON.stringify(raw))[0];
    expect(parsed.cards.card).not.toHaveProperty("epicId");
    expect(parsed.epics?.[0].title).toHaveLength(LIMITS.epicTitle);
    expect(parsed.epics?.[0].position).toBe(0);
    expect(parsed.epics?.[0]).not.toHaveProperty("unknown");
    raw.boards[0].epics.push(epic);
    expect(() => parseExport(JSON.stringify(raw))).toThrow("epics[1].id");
  });

  it.each([1, 2, 3])("imports a version %s backup", (schemaVersion) => {
    const board = fixture();
    expect(
      parseExport(
        JSON.stringify({ app: "janosik", schemaVersion, boards: [board] }),
      ),
    ).toStrictEqual([board]);
  });
});
