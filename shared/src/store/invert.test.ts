import { describe, expect, it } from "vitest";

import { boardReducer, type BoardAction } from "./board-reducer";
import { invert } from "./invert";
import type { Board, Card } from "../types/kanban";

/**
 * The invariant the whole of TASK-21.7 exists for:
 *
 *   boardReducer(boardReducer(before, a), invert(before, a)) === before
 *
 * for **every** action. It only became provable once the reducer stopped
 * reading the clock and minting ids (TASK-21.7a) — with `Date.now()` inside
 * the reducer no two runs produced the same board.
 *
 * "Byte for byte" is literal: the card order, the timestamps and the
 * activity feed all come back (an inverse rewinds the feed it found instead
 * of appending an event of its own). The invariant is checked twice — with
 * the feed on, the way the app runs, and with `withActivity: false`, the
 * way the backend will run the same reducer (§7.4.1).
 */

/** Apply a command the way the app does. */
function reduce(board: Board, action: BoardAction): Board {
  return boardReducer([board], action)[0];
}

/** Apply a command the way the backend will: data only, no activity feed. */
function reduceQuiet(board: Board, action: BoardAction): Board {
  return boardReducer([board], action, { withActivity: false })[0];
}

/** Persisted shape — `{x: undefined}` and a missing `x` are the same board. */
function persisted(board: Board): unknown {
  return JSON.parse(JSON.stringify(board));
}

const AT = 1_700_000_000_000;

function card(id: string, title: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    title,
    labelIds: [],
    createdAt: 100,
    updatedAt: 200,
    activity: [{ id: `ev-${id}`, type: "created", at: 100, actorId: null }],
    ...extra,
  };
}

/**
 * One board carrying every shape an action can touch: a full card (labels,
 * description, checklists, due date, cover), plain cards, a WIP-limited
 * column, an empty column and an archived card (which belongs to no
 * column).
 */
function fixture(): Board {
  return {
    id: "b-1",
    title: "Fixture",
    columns: [
      {
        id: "col-a",
        title: "Alpha",
        cardIds: ["c-1", "c-2", "c-3"],
        createdAt: 10,
      },
      {
        id: "col-b",
        title: "Beta",
        cardIds: ["c-4"],
        wipLimit: 3,
        createdAt: 20,
      },
      { id: "col-c", title: "Gamma", cardIds: [], createdAt: 30 },
    ],
    cards: {
      "c-1": card("c-1", "Zebra", {
        description: "Notes",
        labelIds: ["l-1", "l-2"],
        dueDate: 1_700_000_500_000,
        cover: { type: "color", value: "blue" },
        links: [{ id: "lk-1", type: "blocks", targetCardId: "c-4" }],
        checklists: [
          {
            id: "cl-1",
            title: "Steps",
            items: [
              { id: "it-1", text: "First", done: false },
              { id: "it-2", text: "Second", done: true },
            ],
          },
          { id: "cl-2", title: "Later", items: [] },
        ],
      }),
      "c-2": card("c-2", "Alpha card"),
      "c-3": card("c-3", "Mango", { dueDate: 1_700_000_100_000 }),
      "c-4": card("c-4", "In Beta"),
      "c-arch": card("c-arch", "Archived", {
        archivedAt: 400,
        updatedAt: 400,
      }),
    },
    labels: [
      { id: "l-1", name: "Design", color: "brand" },
      { id: "l-2", name: "Dev", color: "blue" },
      { id: "l-3", name: "Spare", color: "pink" },
    ],
    createdAt: 1,
    updatedAt: 500,
  };
}

/**
 * How each action type is exercised. A `Record` over the union means a new
 * action cannot be added without deciding what it does here — the file
 * stops compiling until it is listed.
 *
 * - an array of commands: each must change the board, and its inverse must
 *   restore it byte for byte;
 * - `"no-inverse"`: the action has no undo step at all (whole-data-set and
 *   board-level bookkeeping).
 */
type Plan = BoardAction[] | "no-inverse";

const PLANS: Record<BoardAction["type"], Plan> = {
  /* columns */
  ADD_COLUMN: [
    { type: "ADD_COLUMN", newColumnId: "col-new", title: "New", at: AT },
  ],
  RENAME_COLUMN: [
    { type: "RENAME_COLUMN", columnId: "col-a", title: "Renamed", at: AT },
  ],
  DELETE_COLUMN: [
    // Takes three cards down with it — the restore has to bring them back.
    { type: "DELETE_COLUMN", columnId: "col-a", at: AT },
    { type: "DELETE_COLUMN", columnId: "col-c", at: AT },
  ],
  MOVE_COLUMN: [
    {
      type: "MOVE_COLUMN",
      columnId: "col-a",
      fromIndex: 0,
      toIndex: 2,
      at: AT,
    },
    {
      type: "MOVE_COLUMN",
      columnId: "col-c",
      fromIndex: 2,
      toIndex: 0,
      at: AT,
    },
    // Out-of-range target: the reducer clamps, the inverse must follow.
    {
      type: "MOVE_COLUMN",
      columnId: "col-a",
      fromIndex: 0,
      toIndex: 9,
      at: AT,
    },
  ],
  SORT_COLUMN: [
    { type: "SORT_COLUMN", columnId: "col-a", sortBy: "title", at: AT },
    { type: "SORT_COLUMN", columnId: "col-a", sortBy: "dueDate", at: AT },
  ],
  SET_COLUMN_CARD_ORDER: [
    {
      type: "SET_COLUMN_CARD_ORDER",
      columnId: "col-a",
      cardIds: ["c-3", "c-1", "c-2"],
      at: AT,
    },
  ],
  SET_COLUMN_WIP_LIMIT: [
    { type: "SET_COLUMN_WIP_LIMIT", columnId: "col-a", wipLimit: 2, at: AT },
    // Clearing an existing limit must put it back.
    { type: "SET_COLUMN_WIP_LIMIT", columnId: "col-b", at: AT },
  ],
  DUPLICATE_COLUMN: [
    {
      type: "DUPLICATE_COLUMN",
      columnId: "col-a",
      newColumnId: "col-copy",
      newCardIds: ["cp-1", "cp-2", "cp-3"],
      title: "Copy of Alpha",
      at: AT,
    },
  ],

  /* board */
  RENAME_BOARD: [{ type: "RENAME_BOARD", title: "Renamed board", at: AT }],

  /* cards */
  ADD_CARD: [
    {
      type: "ADD_CARD",
      newCardId: "c-new",
      columnId: "col-c",
      title: "New",
      at: AT,
    },
    {
      type: "ADD_CARD",
      newCardId: "c-new",
      columnId: "col-a",
      title: "Between",
      atIndex: 1,
      labelIds: ["l-1"],
      at: AT,
    },
  ],
  UPDATE_CARD: [
    { type: "UPDATE_CARD", cardId: "c-1", title: "Renamed", at: AT },
    // Clearing a description drops the field; the inverse writes it back.
    { type: "UPDATE_CARD", cardId: "c-1", description: "", at: AT },
    { type: "UPDATE_CARD", cardId: "c-2", description: "Fresh notes", at: AT },
  ],
  TOUCH_CARD: [{ type: "TOUCH_CARD", cardId: "c-1", at: 999_999 }],
  DELETE_CARD: [
    { type: "DELETE_CARD", cardId: "c-2", at: AT },
    // An archived card sits in no column at all.
    { type: "DELETE_CARD", cardId: "c-arch", at: AT },
  ],
  ARCHIVE_CARD: [{ type: "ARCHIVE_CARD", cardId: "c-2", at: AT }],
  UNARCHIVE_CARD: [
    {
      type: "UNARCHIVE_CARD",
      cardId: "c-arch",
      columnId: "col-a",
      index: 1,
      at: AT,
    },
    { type: "UNARCHIVE_CARD", cardId: "c-arch", at: AT },
  ],
  ARCHIVE_COLUMN_CARDS: [
    { type: "ARCHIVE_COLUMN_CARDS", columnId: "col-a", at: AT },
  ],
  MOVE_CARD: [
    {
      type: "MOVE_CARD",
      cardId: "c-1",
      fromColumnId: "col-a",
      fromIndex: 0,
      toColumnId: "col-b",
      toIndex: 0,
      at: AT,
    },
    {
      type: "MOVE_CARD",
      cardId: "c-1",
      fromColumnId: "col-a",
      fromIndex: 0,
      toColumnId: "col-a",
      toIndex: 2,
      at: AT,
    },
    // Past the end of the destination: clamped on the way there and back.
    {
      type: "MOVE_CARD",
      cardId: "c-3",
      fromColumnId: "col-a",
      fromIndex: 2,
      toColumnId: "col-c",
      toIndex: 7,
      at: AT,
    },
  ],
  DUPLICATE_CARD: [
    {
      type: "DUPLICATE_CARD",
      cardId: "c-1",
      newCardId: "c-copy",
      title: "Copy",
      at: AT,
    },
  ],
  SET_CARD_DUE_DATE: [
    { type: "SET_CARD_DUE_DATE", cardId: "c-1", at: AT },
    {
      type: "SET_CARD_DUE_DATE",
      cardId: "c-2",
      dueDate: 1_700_009_000_000,
      at: AT,
    },
  ],
  SET_CARD_PRIORITY: [
    // Unset = "medium", so both of these actually change the card; the
    // inverses reset to "medium" (dropping the field) and restore.
    { type: "SET_CARD_PRIORITY", cardId: "c-1", priority: "blocker", at: AT },
    { type: "SET_CARD_PRIORITY", cardId: "c-2", priority: "lowest", at: AT },
  ],
  SET_CARD_ASSIGN: [
    // Both cards start unassigned, so both actually change the card; the
    // inverses reset to `null` (dropping the field) and restore.
    { type: "SET_CARD_ASSIGN", cardId: "c-1", assigneeId: "user-1", at: AT },
    { type: "SET_CARD_ASSIGN", cardId: "c-2", assigneeId: "user-2", at: AT },
  ],
  ADD_CARD_LINK: [
    // A fresh pair (c-2 ⇄ c-3 is unlinked in the fixture).
    {
      type: "ADD_CARD_LINK",
      cardId: "c-2",
      linkId: "lk-new",
      targetCardId: "c-3",
      linkType: "blocks",
      at: AT,
    },
    {
      type: "ADD_CARD_LINK",
      cardId: "c-2",
      linkId: "lk-new",
      targetCardId: "c-3",
      linkType: "relates_to",
      at: AT,
    },
  ],
  REMOVE_CARD_LINK: [
    // The fixture's c-1 carries the lk-1 row; removing it is undoable from
    // the command alone (it carries the link's payload for the re-add).
    {
      type: "REMOVE_CARD_LINK",
      cardId: "c-1",
      linkId: "lk-1",
      targetCardId: "c-4",
      linkType: "blocks",
      at: AT,
    },
  ],
  SET_CARD_COVER: [
    { type: "SET_CARD_COVER", cardId: "c-1", at: AT },
    {
      type: "SET_CARD_COVER",
      cardId: "c-2",
      cover: { type: "gradient", value: "ocean" },
      at: AT,
    },
  ],

  /* labels */
  SET_CARD_LABEL: [
    // Detaching the *first* of two labels: the inverse has to put it back
    // at index 0, not at the end.
    {
      type: "SET_CARD_LABEL",
      cardId: "c-1",
      labelId: "l-1",
      on: false,
      at: AT,
    },
    { type: "SET_CARD_LABEL", cardId: "c-2", labelId: "l-3", on: true, at: AT },
  ],
  ADD_LABEL: [
    {
      type: "ADD_LABEL",
      label: { id: "l-new", name: "New", color: "teal" },
      at: AT,
    },
  ],
  RENAME_LABEL: [{ type: "RENAME_LABEL", labelId: "l-1", name: "UX", at: AT }],
  SET_LABEL_COLOR: [
    { type: "SET_LABEL_COLOR", labelId: "l-1", color: "pink", at: AT },
  ],
  DELETE_LABEL: [
    // Attached to c-1 at index 0 — position and attachment both come back.
    { type: "DELETE_LABEL", labelId: "l-1", at: AT },
    { type: "DELETE_LABEL", labelId: "l-3", at: AT },
  ],

  /* checklists */
  ADD_CHECKLIST: [
    {
      type: "ADD_CHECKLIST",
      cardId: "c-1",
      newChecklistId: "cl-new",
      title: "More",
      at: AT,
    },
    // First checklist on a card: the field appears and must disappear again.
    {
      type: "ADD_CHECKLIST",
      cardId: "c-2",
      newChecklistId: "cl-new",
      title: "Steps",
      at: AT,
    },
  ],
  RENAME_CHECKLIST: [
    {
      type: "RENAME_CHECKLIST",
      cardId: "c-1",
      checklistId: "cl-1",
      title: "Plan",
      at: AT,
    },
  ],
  DELETE_CHECKLIST: [
    { type: "DELETE_CHECKLIST", cardId: "c-1", checklistId: "cl-1", at: AT },
    { type: "DELETE_CHECKLIST", cardId: "c-1", checklistId: "cl-2", at: AT },
  ],
  ADD_CHECKLIST_ITEM: [
    {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "c-1",
      checklistId: "cl-1",
      newItemId: "it-new",
      text: "Third",
      at: AT,
    },
  ],
  SET_CHECKLIST_ITEM_DONE: [
    {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "c-1",
      checklistId: "cl-1",
      itemId: "it-1",
      done: true,
      at: AT,
    },
    {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "c-1",
      checklistId: "cl-1",
      itemId: "it-2",
      done: false,
      at: AT,
    },
  ],
  RENAME_CHECKLIST_ITEM: [
    {
      type: "RENAME_CHECKLIST_ITEM",
      cardId: "c-1",
      checklistId: "cl-1",
      itemId: "it-1",
      text: "Renamed",
      at: AT,
    },
  ],
  DELETE_CHECKLIST_ITEM: [
    // The first of two items: the restore has to land at index 0.
    {
      type: "DELETE_CHECKLIST_ITEM",
      cardId: "c-1",
      checklistId: "cl-1",
      itemId: "it-1",
      at: AT,
    },
  ],

  /* the restore family — normally produced by `invert`, dispatchable all
     the same, so their own inverses are covered too */
  RESTORE_CARD: [
    {
      type: "RESTORE_CARD",
      card: card("c-restored", "Back"),
      columnId: "col-a",
      index: 1,
      at: AT,
    },
    { type: "RESTORE_CARD", card: card("c-restored", "Back"), at: AT },
  ],
  RESTORE_COLUMN: [
    {
      type: "RESTORE_COLUMN",
      column: {
        id: "col-back",
        title: "Back",
        cardIds: ["c-back"],
        createdAt: 5,
      },
      index: 1,
      cards: [card("c-back", "Back card")],
      at: AT,
    },
  ],
  RESTORE_LABEL: [
    {
      type: "RESTORE_LABEL",
      label: { id: "l-back", name: "Back", color: "red" },
      index: 1,
      assignments: [{ cardId: "c-1", index: 1 }],
      at: AT,
    },
  ],
  RESTORE_CHECKLIST: [
    {
      type: "RESTORE_CHECKLIST",
      cardId: "c-1",
      checklist: { id: "cl-back", title: "Back", items: [] },
      index: 1,
      at: AT,
    },
  ],
  RESTORE_CHECKLIST_ITEM: [
    {
      type: "RESTORE_CHECKLIST_ITEM",
      cardId: "c-1",
      checklistId: "cl-1",
      item: { id: "it-back", text: "Back", done: false },
      index: 1,
      at: AT,
    },
  ],
  // Undoes itself: the previous card objects plus the previous order.
  RESTORE_COLUMN_CARDS: [
    {
      type: "RESTORE_COLUMN_CARDS",
      columnId: "col-c",
      cardIds: ["c-arch"],
      cards: [card("c-arch", "Archived", { archivedAt: 400, updatedAt: 400 })],
      at: AT,
    },
  ],

  /* no undo step at all */
  RESTORE_BOARD: "no-inverse",
  IMPORT_BOARDS: "no-inverse",
  ADD_BOARD: "no-inverse",
  REMOVE_BOARD: "no-inverse",
  ARCHIVE_BOARD: "no-inverse",
  UNARCHIVE_BOARD: "no-inverse",
};

describe("invert — every action is reversible", () => {
  for (const [type, plan] of Object.entries(PLANS)) {
    if (plan === "no-inverse") {
      it(`${type} has no undo step`, () => {
        // The shape does not matter: these types never produce an inverse.
        const action = { type, at: AT } as unknown as BoardAction;
        expect(invert(fixture(), action)).toBeNull();
      });
      continue;
    }

    plan.forEach((command, i) => {
      const label = plan.length > 1 ? `${type} #${i + 1}` : type;
      it(`${label} — the inverse restores the board`, () => {
        const before = fixture();
        const after = reduce(before, command);
        // A sample that changes nothing would prove nothing.
        expect(after).not.toBe(before);

        const inverse = invert(before, command);
        expect(inverse).not.toBeNull();
        expect(persisted(reduce(after, inverse!))).toEqual(persisted(before));

        // The backend computes the same board from the same pair.
        const quiet = reduceQuiet(before, command);
        expect(persisted(reduceQuiet(quiet, inverse!))).toEqual(
          persisted(before),
        );
      });
    });
  }
});

/**
 * The same invariant over random command sequences: walk a board forward
 * through a few dozen commands, keeping the `{do, undo}` pair of each step
 * the way `BoardHistory` does, then press undo all the way back. This is
 * what a user actually does, and it catches inverses that are only correct
 * in isolation.
 */
describe("invert — undoing a whole session", () => {
  /** Deterministic PRNG: a failing seed is a reproducible failure. */
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x100000000;
    };
  }

  /** A random command that makes sense for the board as it stands. */
  function command(
    board: Board,
    next: () => number,
    step: number,
  ): BoardAction | null {
    const pick = <T>(items: T[]): T | undefined =>
      items.length === 0 ? undefined : items[Math.floor(next() * items.length)];
    const at = AT + step * 1000;
    const column = pick(board.columns);
    const cardIds = board.columns.flatMap((c) => c.cardIds);
    const cardId = pick(cardIds);
    const label = pick(board.labels);
    if (!column) return null;

    switch (step % 12) {
      case 0:
        return {
          type: "ADD_CARD",
          newCardId: `f-card-${step}`,
          columnId: column.id,
          title: `Card ${step}`,
          at,
        };
      case 1:
        return cardId
          ? { type: "UPDATE_CARD", cardId, title: `Renamed ${step}`, at }
          : null;
      case 2:
        return cardId ? { type: "DELETE_CARD", cardId, at } : null;
      case 3: {
        const from = board.columns.find((c) => c.cardIds.length > 0);
        if (!from) return null;
        const fromIndex = Math.floor(next() * from.cardIds.length);
        const to = pick(board.columns)!;
        return {
          type: "MOVE_CARD",
          cardId: from.cardIds[fromIndex],
          fromColumnId: from.id,
          fromIndex,
          toColumnId: to.id,
          toIndex: Math.floor(next() * (to.cardIds.length + 1)),
          at,
        };
      }
      case 4:
        return cardId && label
          ? {
              type: "SET_CARD_LABEL",
              cardId,
              labelId: label.id,
              on: !board.cards[cardId].labelIds.includes(label.id),
              at,
            }
          : null;
      case 5:
        return {
          type: "ADD_COLUMN",
          newColumnId: `f-col-${step}`,
          title: `Column ${step}`,
          at,
        };
      case 6:
        return { type: "DELETE_COLUMN", columnId: column.id, at };
      case 7:
        return {
          type: "MOVE_COLUMN",
          columnId: board.columns[0].id,
          fromIndex: 0,
          toIndex: Math.floor(next() * board.columns.length),
          at,
        };
      case 8:
        return cardId ? { type: "ARCHIVE_CARD", cardId, at } : null;
      case 9:
        return {
          type: "SORT_COLUMN",
          columnId: column.id,
          sortBy: "title",
          at,
        };
      case 10:
        return cardId
          ? {
              type: "ADD_CHECKLIST",
              cardId,
              newChecklistId: `f-cl-${step}`,
              title: "Steps",
              at,
            }
          : null;
      default:
        return label
          ? { type: "DELETE_LABEL", labelId: label.id, at }
          : { type: "RENAME_BOARD", title: `Board ${step}`, at };
    }
  }

  for (const seed of [1, 7, 42, 1234, 98765]) {
    it(`undoes a 40-command session step by step (seed ${seed})`, () => {
      const next = rng(seed);
      const start = fixture();
      let board = start;
      const steps: { before: Board; undo: BoardAction }[] = [];

      for (let i = 0; i < 40; i++) {
        const action = command(board, next, i);
        if (action === null) continue;
        const after = reduce(board, action);
        // Commands the reducer refuses (a guard, a limit) are not steps.
        if (after === board) continue;
        const undo = invert(board, action);
        expect(undo).not.toBeNull();
        steps.push({ before: board, undo: undo! });
        board = after;
      }

      // A session that did nothing would make the walk back vacuous.
      expect(steps.length).toBeGreaterThan(10);

      for (const step of steps.reverse()) {
        board = reduce(board, step.undo);
        expect(persisted(board)).toEqual(persisted(step.before));
      }
      expect(persisted(board)).toEqual(persisted(start));
    });
  }
});
