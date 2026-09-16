import { describe, expect, it } from "vitest";
import type { BoardAction } from "./board-reducer";
import { LIMITS } from "../types/kanban";
import { validateBoardAction } from "./validate";

/**
 * Strict API validation (ROADMAP §7.0): every supported column/card action
 * has a valid form that passes and its malformed variants fail on the exact
 * field the endpoint should report in `400 { field }`.
 */

const card = {
  id: "card-1",
  title: "Card",
  labelIds: [],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const column = {
  id: "col-1",
  title: "Todo",
  cardIds: ["card-1"],
  createdAt: 1_700_000_000_000,
};

const checklist = {
  id: "cl-1",
  title: "Steps",
  items: [{ id: "it-1", text: "one", done: false }],
};

const item = { id: "it-1", text: "one", done: false };

/** Wrap an action body with the shared routing/clock fields. */
function action(body: Record<string, unknown>): Record<string, unknown> {
  return { boardId: "board-1", at: 1_700_000_000_000, ...body };
}

const validActions: BoardAction[] = [
  action({ type: "ADD_COLUMN", newColumnId: "col-2", title: "Doing" }),
  action({ type: "RENAME_COLUMN", columnId: "col-1", title: "Renamed" }),
  action({ type: "DELETE_COLUMN", columnId: "col-1" }),
  action({ type: "MOVE_COLUMN", columnId: "col-1", fromIndex: 0, toIndex: 1 }),
  action({
    type: "DUPLICATE_COLUMN",
    columnId: "col-1",
    newColumnId: "col-2",
    newCardIds: ["card-2"],
  }),
  action({ type: "SORT_COLUMN", columnId: "col-1", sortBy: "dueDate" }),
  action({
    type: "SET_COLUMN_CARD_ORDER",
    columnId: "col-1",
    cardIds: ["card-1"],
  }),
  action({ type: "SET_COLUMN_WIP_LIMIT", columnId: "col-1", wipLimit: 3 }),
  action({ type: "SET_COLUMN_WIP_LIMIT", columnId: "col-1" }),
  action({
    type: "ADD_CARD",
    newCardId: "card-2",
    columnId: "col-1",
    title: "New",
    labelIds: ["label-1"],
    atIndex: 0,
  }),
  action({
    type: "UPDATE_CARD",
    cardId: "card-1",
    title: "Edited",
    description: "notes",
    quiet: true,
  }),
  action({ type: "TOUCH_CARD", cardId: "card-1" }),
  action({ type: "DELETE_CARD", cardId: "card-1" }),
  action({
    type: "ARCHIVE_CARD",
    cardId: "card-1",
    archivedAt: 1_700_000_100_000,
  }),
  action({
    type: "UNARCHIVE_CARD",
    cardId: "card-1",
    columnId: "col-1",
    index: 0,
  }),
  action({ type: "ARCHIVE_COLUMN_CARDS", columnId: "col-1" }),
  action({ type: "SET_CARD_DUE_DATE", cardId: "card-1" }),
  action({
    type: "SET_CARD_DUE_DATE",
    cardId: "card-1",
    dueDate: 1_700_000_200_000,
  }),
  action({
    type: "SET_CARD_COVER",
    cardId: "card-1",
    cover: { type: "gradient", value: "ocean" },
  }),
  action({ type: "SET_CARD_COVER", cardId: "card-1", cover: null }),
  action({
    type: "MOVE_CARD",
    cardId: "card-1",
    fromColumnId: "col-1",
    fromIndex: 0,
    toColumnId: "col-2",
    toIndex: 1,
  }),
  action({ type: "DUPLICATE_CARD", cardId: "card-1", newCardId: "card-3" }),
  action({
    type: "RESTORE_CARD",
    card: { ...card },
    columnId: "col-1",
    index: 0,
  }),
  action({ type: "RESTORE_CARD", card: { ...card } }),
  action({
    type: "RESTORE_COLUMN",
    column: { ...column },
    index: 0,
    cards: [{ ...card }],
  }),
  action({
    type: "RESTORE_COLUMN_CARDS",
    columnId: "col-1",
    cardIds: ["card-1"],
    cards: [{ ...card }],
  }),
  action({
    type: "RESTORE_CHECKLIST",
    cardId: "card-1",
    checklist: { ...checklist },
    index: 0,
  }),
  action({
    type: "RESTORE_CHECKLIST_ITEM",
    cardId: "card-1",
    checklistId: "cl-1",
    item: { ...item },
    index: 0,
  }),
] as unknown as BoardAction[];

describe("validateBoardAction — accepted shapes", () => {
  it.each(validActions.map((a) => [a.type, a] as const))(
    "accepts %s",
    (_type, input) => {
      expect(validateBoardAction(input)).toEqual({ ok: true, action: input });
    },
  );

  it("accepts an inverse command with activity ids", () => {
    const input = action({
      type: "DELETE_CARD",
      cardId: "card-1",
      inverse: true,
      activityIds: ["act-1"],
      cardActivity: [],
    });
    expect(validateBoardAction(input)).toEqual({ ok: true, action: input });
  });
});

describe("validateBoardAction — rejected shapes", () => {
  it.each([
    ["null", null, "action"],
    ["a primitive", 42, "action"],
    ["an array", [], "action"],
    ["a missing type", { at: 1 }, "action.type"],
    ["a non-string type", { type: 7, at: 1 }, "action.type"],
    ["an unknown type", action({ type: "SET_CARD_LABEL" }), "action.type"],
    ["a missing clock", { type: "DELETE_CARD", cardId: "c" }, "action.at"],
    [
      "a non-finite clock",
      action({ type: "DELETE_CARD", cardId: "c", at: Infinity }),
      "action.at",
    ],
    [
      "a non-boolean inverse",
      action({ type: "DELETE_CARD", cardId: "c", inverse: "yes" }),
      "action.inverse",
    ],
    [
      "a malformed activityIds",
      action({ type: "DELETE_CARD", cardId: "c", activityIds: [1] }),
      "action.activityIds[0]",
    ],
    [
      "a blank column title",
      action({ type: "ADD_COLUMN", newColumnId: "x", title: "  " }),
      "action.title",
    ],
    [
      "an over-long column title",
      action({
        type: "ADD_COLUMN",
        newColumnId: "x",
        title: "x".repeat(LIMITS.columnTitle + 1),
      }),
      "action.title",
    ],
    [
      "a missing columnId",
      action({ type: "RENAME_COLUMN", title: "x" }),
      "action.columnId",
    ],
    [
      "a negative move index",
      action({ type: "MOVE_COLUMN", columnId: "c", fromIndex: -1, toIndex: 0 }),
      "action.fromIndex",
    ],
    [
      "a fractional move index",
      action({
        type: "MOVE_COLUMN",
        columnId: "c",
        fromIndex: 0,
        toIndex: 1.5,
      }),
      "action.toIndex",
    ],
    [
      "duplicate column ids not an array",
      action({
        type: "DUPLICATE_COLUMN",
        columnId: "c",
        newColumnId: "d",
        newCardIds: "x",
      }),
      "action.newCardIds",
    ],
    [
      "an unknown sort key",
      action({ type: "SORT_COLUMN", columnId: "c", sortBy: "name" }),
      "action.sortBy",
    ],
    [
      "a bad card-order list",
      action({ type: "SET_COLUMN_CARD_ORDER", columnId: "c", cardIds: [""] }),
      "action.cardIds[0]",
    ],
    [
      "a zero wip limit",
      action({ type: "SET_COLUMN_WIP_LIMIT", columnId: "c", wipLimit: 0 }),
      "action.wipLimit",
    ],
    [
      "an over-max wip limit",
      action({
        type: "SET_COLUMN_WIP_LIMIT",
        columnId: "c",
        wipLimit: LIMITS.wipLimitMax + 1,
      }),
      "action.wipLimit",
    ],
    [
      "a blank card title",
      action({ type: "ADD_CARD", newCardId: "c2", columnId: "c", title: "" }),
      "action.title",
    ],
    [
      "too many label ids",
      action({
        type: "ADD_CARD",
        newCardId: "c2",
        columnId: "c",
        title: "x",
        labelIds: Array.from(
          { length: LIMITS.labelsPerCard + 1 },
          (_, i) => `l-${i}`,
        ),
      }),
      "action.labelIds",
    ],
    [
      "an over-long card title in an update",
      action({
        type: "UPDATE_CARD",
        cardId: "c",
        title: "x".repeat(LIMITS.cardTitle + 1),
      }),
      "action.title",
    ],
    [
      "a non-boolean quiet flag",
      action({ type: "UPDATE_CARD", cardId: "c", quiet: 1 }),
      "action.quiet",
    ],
    [
      "an unknown cover type",
      action({
        type: "SET_CARD_COVER",
        cardId: "c",
        cover: { type: "photo", value: "x" },
      }),
      "action.cover.type",
    ],
    [
      "an unknown cover value",
      action({
        type: "SET_CARD_COVER",
        cardId: "c",
        cover: { type: "color", value: "mauve" },
      }),
      "action.cover.value",
    ],
    [
      "a malformed restore card",
      action({ type: "RESTORE_CARD", card: { id: "c" } }),
      "action.card.title",
    ],
    [
      "a non-object restore column",
      action({ type: "RESTORE_COLUMN", column: 3, index: 0, cards: [] }),
      "action.column",
    ],
    [
      "restore column cards not an array",
      action({
        type: "RESTORE_COLUMN",
        column: { ...column },
        index: 0,
        cards: "x",
      }),
      "action.cards",
    ],
    [
      "an over-max restore column wip limit",
      action({
        type: "RESTORE_COLUMN",
        column: { ...column, wipLimit: LIMITS.wipLimitMax + 1 },
        index: 0,
        cards: [],
      }),
      "action.column.wipLimit",
    ],
    [
      "restore column cards malformed",
      action({
        type: "RESTORE_COLUMN_CARDS",
        columnId: "c",
        cardIds: ["c2"],
        cards: [{ id: "c2" }],
      }),
      "action.cards[0].title",
    ],
    [
      "a malformed checklist",
      action({
        type: "RESTORE_CHECKLIST",
        cardId: "c",
        checklist: { id: "cl", title: "t", items: "x" },
        index: 0,
      }),
      "action.checklist.items",
    ],
    [
      "a malformed checklist item",
      action({
        type: "RESTORE_CHECKLIST_ITEM",
        cardId: "c",
        checklistId: "cl",
        item: { id: "i", text: "t", done: "no" },
        index: 0,
      }),
      "action.item.done",
    ],
  ])("rejects %s", (_label, input, field) => {
    const result = validateBoardAction(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe(field);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
