import { describe, expect, it } from "vitest";
import {
  boardReducer,
  initialBoardState,
  type BoardAction,
} from "./board-reducer";
import { invert } from "./invert";
import type { Board } from "../types/kanban";
import { LIMITS, MAX_CARD_ACTIVITY } from "../types/kanban";
import { MAX_ID_LENGTH, validateBoardAction } from "./validate";

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
    type: "RESTORE_CARD",
    card: {
      ...card,
      description: "notes",
      dueDate: 1_700_000_200_000,
      cover: { type: "gradient", value: "ocean" },
      checklists: [{ ...checklist }],
    },
    columnId: "col-1",
    index: 0,
  }),
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
  action({
    type: "SET_CARD_LABEL",
    cardId: "card-1",
    labelId: "label-1",
    on: true,
    index: 0,
  }),
  action({
    type: "SET_CARD_LABEL",
    cardId: "card-1",
    labelId: "label-1",
    on: false,
  }),
  action({
    type: "ADD_LABEL",
    label: { id: "label-2", name: "Bug", color: "red" },
  }),
  action({ type: "RENAME_LABEL", labelId: "label-1", name: "Renamed" }),
  action({ type: "SET_LABEL_COLOR", labelId: "label-1", color: "brand" }),
  action({ type: "DELETE_LABEL", labelId: "label-1" }),
  action({
    type: "RESTORE_LABEL",
    label: { id: "label-1", name: "Bug", color: "amber" },
    index: 0,
    assignments: [{ cardId: "card-1", index: 0 }],
  }),
  action({
    type: "RESTORE_LABEL",
    label: { id: "l", name: "B", color: "red" },
    index: 0,
  }),
  action({
    type: "ADD_CHECKLIST",
    cardId: "card-1",
    newChecklistId: "cl-2",
    title: "Steps",
  }),
  action({
    type: "RENAME_CHECKLIST",
    cardId: "card-1",
    checklistId: "cl-1",
    title: "Renamed",
  }),
  action({
    type: "DELETE_CHECKLIST",
    cardId: "card-1",
    checklistId: "cl-1",
  }),
  action({
    type: "ADD_CHECKLIST_ITEM",
    cardId: "card-1",
    checklistId: "cl-1",
    newItemId: "it-2",
    text: "two",
  }),
  action({
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId: "card-1",
    checklistId: "cl-1",
    itemId: "it-1",
    done: true,
  }),
  action({
    type: "RENAME_CHECKLIST_ITEM",
    cardId: "card-1",
    checklistId: "cl-1",
    itemId: "it-1",
    text: "renamed",
  }),
  action({
    type: "DELETE_CHECKLIST_ITEM",
    cardId: "card-1",
    checklistId: "cl-1",
    itemId: "it-1",
  }),
  action({ type: "RENAME_BOARD", title: "Renamed board" }),
  action({ type: "ARCHIVE_BOARD" }),
  action({ type: "UNARCHIVE_BOARD" }),
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
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "Old",
      inverse: true,
      activityIds: ["act-1"],
      boardUpdatedAt: 1_700_000_000_000,
      cardUpdatedAt: 1_699_000_000_000,
      cardActivity: [],
    });
    expect(validateBoardAction(input)).toEqual({ ok: true, action: input });
  });

  it("reads a JSON null optional as absent (cover cleared)", () => {
    const input = action({
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: null,
    });
    const result = validateBoardAction(input);
    expect(result).toEqual({
      ok: true,
      action: action({ type: "SET_CARD_COVER", cardId: "card-1" }),
    });
  });
});

describe("validateBoardAction — rejected shapes", () => {
  it.each([
    ["null", null, "action"],
    ["a primitive", 42, "action"],
    ["an array", [], "action"],
    ["a missing type", { at: 1 }, "action.type"],
    ["a non-string type", { type: 7, at: 1 }, "action.type"],
    ["an unknown type", action({ type: "ADD_BOARD" }), "action.type"],
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
      "a blank board title",
      action({ type: "RENAME_BOARD", title: "  " }),
      "action.title",
    ],
    [
      "an over-long board title",
      action({
        type: "RENAME_BOARD",
        title: "x".repeat(LIMITS.boardTitle + 1),
      }),
      "action.title",
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
      "an oversized restore card description",
      action({
        type: "RESTORE_CARD",
        card: { ...card, description: "x".repeat(LIMITS.description + 1) },
        columnId: "col-1",
        index: 0,
      }),
      "action.card.description",
    ],
    [
      "an unknown cover on a restore card",
      action({
        type: "RESTORE_CARD",
        card: { ...card, cover: { type: "photo", value: "x" } },
        columnId: "col-1",
        index: 0,
      }),
      "action.card.cover.type",
    ],
    [
      "an over-max restore card checklist count",
      action({
        type: "RESTORE_CARD",
        card: {
          ...card,
          checklists: Array.from(
            { length: LIMITS.checklistsPerCard + 1 },
            (_, index) => ({ id: `cl-${index}`, title: "t", items: [] }),
          ),
        },
        columnId: "col-1",
        index: 0,
      }),
      "action.card.checklists",
    ],
    [
      "an over-max restore checklist item count",
      action({
        type: "RESTORE_CHECKLIST",
        cardId: "card-1",
        checklist: {
          id: "cl-1",
          title: "t",
          items: Array.from(
            { length: LIMITS.itemsPerChecklist + 1 },
            (_, index) => ({ id: `it-${index}`, text: "x", done: false }),
          ),
        },
        index: 0,
      }),
      "action.checklist.items",
    ],
    [
      "an over-max restore column card count",
      action({
        type: "RESTORE_COLUMN",
        column: {
          ...column,
          cardIds: Array.from(
            { length: LIMITS.cardsPerColumn + 1 },
            (_, index) => `c-${index}`,
          ),
        },
        index: 0,
        cards: [],
      }),
      "action.column.cardIds",
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
    [
      "a missing label id",
      action({ type: "SET_CARD_LABEL", cardId: "c", on: true }),
      "action.labelId",
    ],
    [
      "a non-boolean label flag",
      action({ type: "SET_CARD_LABEL", cardId: "c", labelId: "l", on: "yes" }),
      "action.on",
    ],
    [
      "an over-long label name",
      action({
        type: "RENAME_LABEL",
        labelId: "l",
        name: "x".repeat(LIMITS.labelName + 1),
      }),
      "action.name",
    ],
    [
      "an unknown label color",
      action({ type: "SET_LABEL_COLOR", labelId: "l", color: "mauve" }),
      "action.color",
    ],
    [
      "a malformed label",
      action({ type: "ADD_LABEL", label: { id: "l", name: "B", color: 7 } }),
      "action.label.color",
    ],
    [
      "restore label assignments not an array",
      action({
        type: "RESTORE_LABEL",
        label: { id: "l", name: "B", color: "red" },
        index: 0,
        assignments: "x",
      }),
      "action.assignments",
    ],
    [
      "a malformed restore label assignment",
      action({
        type: "RESTORE_LABEL",
        label: { id: "l", name: "B", color: "red" },
        index: 0,
        assignments: [{ cardId: "c" }],
      }),
      "action.assignments[0].index",
    ],
    [
      "a blank checklist title",
      action({
        type: "ADD_CHECKLIST",
        cardId: "c",
        newChecklistId: "cl",
        title: "  ",
      }),
      "action.title",
    ],
    [
      "a non-boolean checklist item done flag",
      action({
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: "c",
        checklistId: "cl",
        itemId: "i",
        done: 1,
      }),
      "action.done",
    ],
    [
      "an over-long checklist item text",
      action({
        type: "RENAME_CHECKLIST_ITEM",
        cardId: "c",
        checklistId: "cl",
        itemId: "i",
        text: "x".repeat(LIMITS.checklistItem + 1),
      }),
      "action.text",
    ],
  ])("rejects %s", (_label, input, field) => {
    const result = validateBoardAction(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe(field);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

/** JSON round-trip: the shape a command has once it crossed the wire. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * S-3: the undo of a delete must pass the server's validator. A card the
 * reducer created carries an activity feed whose entries are `type`d, not
 * `kind`ed — the validator used to demand the wrong field and every such
 * undo answered 400.
 */
describe("validateBoardAction — restores built from real cards (S-3)", () => {
  /** A board whose card-new was created (and renamed) by the reducer. */
  function boardWithLiveCard(): Board {
    let state = initialBoardState();
    state = boardReducer(state, {
      type: "ADD_CARD",
      newCardId: "card-new",
      columnId: "col-backlog",
      title: "Fresh",
      at: 1_700_000_000_000,
      actorId: "user-1",
      activityIds: ["act-created"],
    });
    state = boardReducer(state, {
      type: "UPDATE_CARD",
      cardId: "card-new",
      title: "Renamed",
      at: 1_700_000_100_000,
      activityIds: ["act-renamed"],
    });
    return state[0];
  }

  it("accepts the RESTORE_CARD invert() builds for a deleted live card", () => {
    const before = boardWithLiveCard();
    expect(before.cards["card-new"].activity).toHaveLength(2);
    const inverse = invert(before, {
      type: "DELETE_CARD",
      cardId: "card-new",
      at: 1_700_000_200_000,
    });
    expect(inverse?.type).toBe("RESTORE_CARD");
    const result = validateBoardAction(wire(inverse));
    expect(result).toEqual({ ok: true, action: wire(inverse) });
  });

  it("rejects an activity entry of an unknown type", () => {
    const result = validateBoardAction(
      action({
        type: "RESTORE_CARD",
        card: {
          ...card,
          activity: [{ id: "a", kind: "created", at: 1, actorId: null }],
        },
        columnId: "col-1",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      field: "action.card.activity[0].type",
    });
  });

  it("caps the feed at MAX_CARD_ACTIVITY entries", () => {
    const activity = Array.from({ length: MAX_CARD_ACTIVITY + 1 }, (_, i) => ({
      id: `a-${i}`,
      type: "renamed",
      at: 1,
      actorId: null,
    }));
    const result = validateBoardAction(
      action({
        type: "RESTORE_CARD",
        card: { ...card, activity },
        columnId: "col-1",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      field: "action.card.activity",
    });
  });
});

/**
 * S-4: the validated action is rebuilt from an allow-list, so whatever the
 * type does not define never reaches the reducer, the log or the SSE fan-out.
 */
describe("validateBoardAction — rebuilds the action (S-4)", () => {
  it("returns a new object, not the input", () => {
    const input = action({ type: "DELETE_CARD", cardId: "card-1" });
    const result = validateBoardAction(input);
    expect(result.ok && result.action).not.toBe(input);
  });

  it("drops fields the command type does not define", () => {
    const result = validateBoardAction(
      action({
        type: "RESTORE_CARD",
        card: { ...card, evil: 1 },
        columnId: "col-1",
        actorId: "someone-else",
        __proto__x: 1,
        quiet: true,
      }),
    );
    expect(result).toEqual({
      ok: true,
      action: action({ type: "RESTORE_CARD", card, columnId: "col-1" }),
    });
  });

  it("drops inverse-only overrides from a fresh command", () => {
    const result = validateBoardAction(
      action({
        type: "UPDATE_CARD",
        cardId: "card-1",
        title: "x",
        boardUpdatedAt: 1,
        cardUpdatedAt: "not even a number",
        cardActivity: [{ evil: 1 }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      action: action({ type: "UPDATE_CARD", cardId: "card-1", title: "x" }),
    });
  });

  it("drops a feed rewind on a type invert() never puts one on", () => {
    const result = validateBoardAction(
      action({
        type: "DELETE_CARD",
        cardId: "card-1",
        inverse: true,
        cardActivity: [],
      }),
    );
    expect(result).toEqual({
      ok: true,
      action: action({ type: "DELETE_CARD", cardId: "card-1", inverse: true }),
    });
  });

  it.each([
    ["a string cardUpdatedAt", { cardUpdatedAt: "x" }, "action.cardUpdatedAt"],
    [
      "a boardUpdatedAt outside the Date range",
      { boardUpdatedAt: 1e300 },
      "action.boardUpdatedAt",
    ],
    [
      "a malformed feed entry",
      { cardActivity: [{ evil: 1 }] },
      "action.cardActivity[0].id",
    ],
  ])("type-checks the inverse-only fields: %s", (_label, extra, field) => {
    const result = validateBoardAction(
      action({
        type: "UPDATE_CARD",
        cardId: "card-1",
        title: "x",
        inverse: true,
        ...extra,
      }),
    );
    expect(result).toMatchObject({ ok: false, field });
  });

  it("rejects a clock outside the Date range", () => {
    for (const at of [1e300, -1e300, 8.64e15 + 1]) {
      expect(
        validateBoardAction(action({ type: "DELETE_CARD", cardId: "c", at })),
      ).toMatchObject({ ok: false, field: "action.at" });
    }
  });

  it("passes every inverse invert() emits through unchanged", () => {
    let state = initialBoardState();
    const at = 1_700_000_000_000;
    // Give cards a feed, a checklist and a label so every inverse carries
    // its overrides (`cardUpdatedAt`, `cardActivity`, snapshots).
    state = boardReducer(state, {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: "cl-1",
      title: "Steps",
      at,
    });
    state = boardReducer(state, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      newItemId: "it-1",
      text: "one",
      at,
    });
    state = boardReducer(state, {
      type: "ARCHIVE_CARD",
      cardId: "card-3",
      at,
    });
    const before = state[0];
    const labelId = before.labels[0].id;
    const commands: BoardAction[] = [
      { type: "UPDATE_CARD", cardId: "card-1", title: "New", at },
      { type: "TOUCH_CARD", cardId: "card-1", at },
      { type: "DELETE_CARD", cardId: "card-1", at },
      { type: "DELETE_CARD", cardId: "card-3", at },
      { type: "ARCHIVE_CARD", cardId: "card-2", at },
      { type: "UNARCHIVE_CARD", cardId: "card-3", at },
      { type: "ARCHIVE_COLUMN_CARDS", columnId: "col-backlog", at },
      { type: "DELETE_COLUMN", columnId: "col-backlog", at },
      { type: "SORT_COLUMN", columnId: "col-backlog", sortBy: "title", at },
      { type: "SET_COLUMN_WIP_LIMIT", columnId: "col-done", wipLimit: 3, at },
      {
        type: "MOVE_CARD",
        cardId: "card-1",
        fromColumnId: "col-backlog",
        fromIndex: 0,
        toColumnId: "col-done",
        toIndex: 0,
        at,
      },
      {
        type: "MOVE_COLUMN",
        columnId: "col-done",
        fromIndex: 2,
        toIndex: 0,
        at,
      },
      { type: "SET_CARD_DUE_DATE", cardId: "card-1", dueDate: at, at },
      { type: "SET_CARD_PRIORITY", cardId: "card-1", priority: "high", at },
      { type: "SET_CARD_ASSIGN", cardId: "card-1", assigneeId: "u-1", at },
      {
        type: "CLAIM_CARD",
        cardId: "card-1",
        claimedBy: "u-1",
        leaseUntil: at + 900_000,
        at,
      },
      {
        type: "SET_CARD_COVER",
        cardId: "card-1",
        cover: { type: "color", value: "red" },
        at,
      },
      { type: "SET_CARD_LABEL", cardId: "card-1", labelId, on: false, at },
      { type: "DELETE_LABEL", labelId, at },
      { type: "RENAME_LABEL", labelId, name: "X", at },
      { type: "DELETE_CHECKLIST", cardId: "card-1", checklistId: "cl-1", at },
      {
        type: "DELETE_CHECKLIST_ITEM",
        cardId: "card-1",
        checklistId: "cl-1",
        itemId: "it-1",
        at,
      },
      {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: "card-1",
        checklistId: "cl-1",
        itemId: "it-1",
        done: true,
        at,
      },
      {
        type: "ADD_CARD_LINK",
        cardId: "card-1",
        linkId: "ln-1",
        targetCardId: "card-2",
        linkType: "blocks",
        at,
      },
      { type: "RENAME_BOARD", title: "Board", at },
      { type: "RENAME_COLUMN", columnId: "col-done", title: "Shipped", at },
    ];
    for (const command of commands) {
      const inverse = invert(before, command);
      expect(inverse, command.type).not.toBeNull();
      expect(validateBoardAction(wire(inverse)), command.type).toEqual({
        ok: true,
        action: wire(inverse),
      });
    }
  });
});

describe("validateBoardAction — string and id bounds", () => {
  it("measures the raw length, not the trimmed one", () => {
    const padded = " ".repeat(LIMITS.columnTitle) + "x";
    expect(
      validateBoardAction(
        action({ type: "RENAME_COLUMN", columnId: "c", title: padded }),
      ),
    ).toMatchObject({ ok: false, field: "action.title" });
  });

  it("caps id length", () => {
    const ok = "i".repeat(MAX_ID_LENGTH);
    expect(
      validateBoardAction(action({ type: "DELETE_CARD", cardId: ok })).ok,
    ).toBe(true);
    expect(
      validateBoardAction(action({ type: "DELETE_CARD", cardId: ok + "i" })),
    ).toMatchObject({ ok: false, field: "action.cardId" });
    expect(
      validateBoardAction(
        action({
          type: "ADD_CARD",
          columnId: "c",
          title: "x",
          newCardId: "i".repeat(1_000_000),
        }),
      ),
    ).toMatchObject({ ok: false, field: "action.newCardId" });
  });

  it("accepts the real id shapes (UUID, cuid, mcp- command id)", () => {
    const result = validateBoardAction(
      action({
        type: "DELETE_CARD",
        cardId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        boardId: "clh3am8f00000qwer1234abcd",
        commandId: `mcp-${"a".repeat(60)}`,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects __proto__ as an id", () => {
    expect(
      validateBoardAction(
        action({
          type: "ADD_CARD",
          columnId: "c",
          title: "x",
          newCardId: "__proto__",
        }),
      ),
    ).toMatchObject({ ok: false, field: "action.newCardId" });
  });

  it.each([
    ["newCardIds", "DUPLICATE_COLUMN", { columnId: "c", newColumnId: "d" }],
    ["cardIds", "SET_COLUMN_CARD_ORDER", { columnId: "c" }],
    ["activityIds", "DELETE_CARD", { cardId: "c" }],
  ])("caps the %s array", (key, type, body) => {
    const ids = Array.from(
      { length: LIMITS.cardsPerColumn + 1 },
      (_, i) => `id-${i}`,
    );
    expect(
      validateBoardAction(action({ type, ...body, [key]: ids })),
    ).toMatchObject({ ok: false, field: `action.${key}` });
  });
});
