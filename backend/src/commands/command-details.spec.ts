import type { Board, BoardAction, Card } from "@janosik/shared";
import { commandDetails } from "./command-details";

/**
 * The display snapshot the history feed renders (TASK-37): pure before →
 * after diffs computed while both aggregates are still in hand.
 */

const AT = 1_700_000_000_000;

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    title: "Old title",
    labelIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function makeBoard(card: Card = makeCard()): Board {
  return {
    id: "board-1",
    title: "Board",
    columns: [
      { id: "col-1", title: "Todo", cardIds: [card.id], createdAt: AT },
      { id: "col-2", title: "Done", cardIds: [], createdAt: AT },
    ],
    cards: { [card.id]: card },
    labels: [
      { id: "label-1", name: "Bug", color: "red" },
      { id: "label-2", name: "Feature", color: "blue" },
    ],
    createdAt: AT,
    updatedAt: AT,
  };
}

const base = { boardId: "board-1", at: AT } as const;

describe("commandDetails", () => {
  it("captures a title rename as from → to", () => {
    const before = makeBoard(makeCard({ title: "Old title" }));
    const after = makeBoard(makeCard({ title: "New title" }));
    const action = {
      ...base,
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "New title",
    } as BoardAction;

    expect(commandDetails(action, before, after)).toEqual({
      changes: [{ field: "title", from: "Old title", to: "New title" }],
    });
  });

  it("captures quiet per-keystroke description edits", () => {
    const before = makeBoard(makeCard({ description: "ab" }));
    const after = makeBoard(makeCard({ description: "abc" }));
    const action = {
      ...base,
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "abc",
      quiet: true,
    } as BoardAction;

    expect(commandDetails(action, before, after)).toEqual({
      changes: [{ field: "description", from: "ab", to: "abc" }],
    });
  });

  it("resolves a move to column titles", () => {
    const before = makeBoard();
    const after = makeBoard();
    after.columns = [
      { id: "col-1", title: "Todo", cardIds: [], createdAt: AT },
      { id: "col-2", title: "Done", cardIds: ["card-1"], createdAt: AT },
    ];
    const action = {
      ...base,
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-1",
      toColumnId: "col-2",
      toIndex: 0,
    } as BoardAction;

    expect(commandDetails(action, before, after)).toEqual({
      detail: "Done",
      changes: [{ field: "column", from: "Todo", to: "Done" }],
    });
  });

  it("names the column on add, rename and delete", () => {
    const before = makeBoard();
    const added = makeBoard();
    added.columns = [
      ...before.columns,
      { id: "col-3", title: "Design", cardIds: [], createdAt: AT },
    ];
    expect(
      commandDetails(
        {
          ...base,
          type: "ADD_COLUMN",
          newColumnId: "col-3",
          title: "Design",
        } as BoardAction,
        before,
        added,
      ),
    ).toEqual({ changes: [{ field: "column", from: null, to: "Design" }] });

    const renamed = makeBoard();
    renamed.columns = [
      { id: "col-1", title: "Backlog", cardIds: ["card-1"], createdAt: AT },
      { id: "col-2", title: "Done", cardIds: [], createdAt: AT },
    ];
    expect(
      commandDetails(
        {
          ...base,
          type: "RENAME_COLUMN",
          columnId: "col-1",
          title: "Backlog",
        } as BoardAction,
        before,
        renamed,
      ),
    ).toEqual({ changes: [{ field: "column", from: "Todo", to: "Backlog" }] });

    expect(
      commandDetails(
        { ...base, type: "DELETE_COLUMN", columnId: "col-1" } as BoardAction,
        before,
        makeBoard(),
      ),
    ).toEqual({ changes: [{ field: "column", from: "Todo", to: null }] });
  });

  it("captures a board rename", () => {
    const before = makeBoard();
    const after = { ...makeBoard(), title: "New board" };
    expect(
      commandDetails(
        { ...base, type: "RENAME_BOARD", title: "New board" } as BoardAction,
        before,
        after,
      ),
    ).toEqual({
      changes: [{ field: "title", from: "Board", to: "New board" }],
    });
  });

  it("names labels on create, rename, colour and delete", () => {
    const before = makeBoard();
    const withLabel = makeBoard();
    withLabel.labels = [
      ...before.labels,
      { id: "label-3", name: "Design", color: "fuchsia" },
    ];
    expect(
      commandDetails(
        {
          ...base,
          type: "ADD_LABEL",
          label: { id: "label-3", name: "Design", color: "fuchsia" },
        } as BoardAction,
        before,
        withLabel,
      ),
    ).toEqual({ changes: [{ field: "label", from: null, to: "Design" }] });

    const renamed = makeBoard();
    renamed.labels = [
      { id: "label-1", name: "Defect", color: "red" },
      { id: "label-2", name: "Feature", color: "blue" },
    ];
    expect(
      commandDetails(
        {
          ...base,
          type: "RENAME_LABEL",
          labelId: "label-1",
          name: "Defect",
        } as BoardAction,
        before,
        renamed,
      ),
    ).toEqual({ changes: [{ field: "label", from: "Bug", to: "Defect" }] });

    const recolored = makeBoard();
    recolored.labels = [
      { id: "label-1", name: "Bug", color: "orange" },
      { id: "label-2", name: "Feature", color: "blue" },
    ];
    expect(
      commandDetails(
        {
          ...base,
          type: "SET_LABEL_COLOR",
          labelId: "label-1",
          color: "orange",
        } as BoardAction,
        before,
        recolored,
      ),
    ).toEqual({ changes: [{ field: "label", from: "red", to: "orange" }] });

    expect(
      commandDetails(
        { ...base, type: "DELETE_LABEL", labelId: "label-1" } as BoardAction,
        before,
        makeBoard(),
      ),
    ).toEqual({ changes: [{ field: "label", from: "Bug", to: null }] });
  });

  it("names a deleted card", () => {
    const before = makeBoard();
    expect(
      commandDetails(
        { ...base, type: "DELETE_CARD", cardId: "card-1" } as BoardAction,
        before,
        before,
      ),
    ).toEqual({ detail: "Old title" });
  });

  it("names the label on attach and detach", () => {
    const before = makeBoard();
    const after = makeBoard(makeCard({ labelIds: ["label-1"] }));
    const attach = {
      ...base,
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId: "label-1",
      on: true,
    } as BoardAction;
    expect(commandDetails(attach, before, after)).toEqual({
      detail: "Bug",
      changes: [{ field: "label", from: null, to: "Bug" }],
    });

    const detach = { ...attach, on: false } as BoardAction;
    expect(commandDetails(detach, after, before)).toEqual({
      detail: "Bug",
      changes: [{ field: "label", from: "Bug", to: null }],
    });
  });

  it("captures due-date set and clear as ISO strings", () => {
    const due = Date.UTC(2026, 8, 20);
    const before = makeBoard();
    const withDue = makeBoard(makeCard({ dueDate: due }));
    const set = {
      ...base,
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: due,
    } as BoardAction;
    const clear = {
      ...base,
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
    } as BoardAction;

    expect(commandDetails(set, before, withDue)?.changes).toEqual([
      {
        field: "dueDate",
        from: null,
        to: new Date(due).toISOString(),
      },
    ]);
    expect(commandDetails(clear, withDue, before)?.changes).toEqual([
      {
        field: "dueDate",
        from: new Date(due).toISOString(),
        to: null,
      },
    ]);
  });

  it("captures the priority change with the default for unset fields", () => {
    const before = makeBoard();
    const withPriority = makeBoard(makeCard({ priority: "blocker" }));
    const set = {
      ...base,
      type: "SET_CARD_PRIORITY",
      cardId: "card-1",
      priority: "blocker",
    } as BoardAction;
    const reset = {
      ...base,
      type: "SET_CARD_PRIORITY",
      cardId: "card-1",
      priority: "medium",
    } as BoardAction;

    expect(commandDetails(set, before, withPriority)?.changes).toEqual([
      { field: "priority", from: "medium", to: "blocker" },
    ]);
    expect(commandDetails(reset, withPriority, before)?.changes).toEqual([
      { field: "priority", from: "blocker", to: "medium" },
    ]);
  });

  it("captures the assignee change with null for unassigned", () => {
    const before = makeBoard();
    const withAssignee = makeBoard(makeCard({ assigneeId: "user-2" } as never));
    const set = {
      ...base,
      type: "SET_CARD_ASSIGN",
      cardId: "card-1",
      assigneeId: "user-2",
    } as BoardAction;
    const unassign = {
      ...base,
      type: "SET_CARD_ASSIGN",
      cardId: "card-1",
      assigneeId: null,
    } as BoardAction;

    expect(commandDetails(set, before, withAssignee)?.changes).toEqual([
      { field: "assignee", from: null, to: "user-2" },
    ]);
    expect(commandDetails(unassign, withAssignee, before)?.changes).toEqual([
      { field: "assignee", from: "user-2", to: null },
    ]);
  });

  it("freezes the linked card's title on add and remove", () => {
    const target = makeCard({ id: "card-2", title: "Target card" });
    const source = makeCard({
      links: [{ id: "lk-1", type: "blocks", targetCardId: "card-2" }],
    });
    const linked = makeBoard(source);
    // makeBoard puts one card in the column; the target must be on the
    // board too for its title to resolve.
    linked.columns[0].cardIds.push("card-2");
    linked.cards["card-2"] = target;
    const unlinked = makeBoard(makeCard());
    unlinked.columns[0].cardIds.push("card-2");
    unlinked.cards["card-2"] = target;
    const add = {
      ...base,
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: "lk-1",
      targetCardId: "card-2",
      linkType: "blocks",
    } as BoardAction;
    const remove = {
      ...base,
      type: "REMOVE_CARD_LINK",
      cardId: "card-1",
      linkId: "lk-1",
      targetCardId: "card-2",
      linkType: "blocks",
    } as BoardAction;

    expect(commandDetails(add, unlinked, linked)).toEqual({
      detail: "Target card",
      changes: [{ field: "link", from: null, to: "Target card" }],
    });
    expect(commandDetails(remove, linked, unlinked)).toEqual({
      detail: "Target card",
      changes: [{ field: "link", from: "Target card", to: null }],
    });
    // A dangling-target remove still reads well: the title is frozen from
    // whichever aggregate still has it, so the sentence keeps its name.
    expect(commandDetails(remove, linked, linked)).toEqual({
      detail: "Target card",
      changes: [{ field: "link", from: "Target card", to: null }],
    });
  });

  it("captures checklist items: add, rename, check and delete", () => {
    const checklist = {
      id: "cl-1",
      title: "Shopping",
      items: [{ id: "item-1", text: "Milk", done: false }],
    };
    const before = makeBoard(makeCard({ checklists: [checklist] }));
    const renamed = makeBoard(
      makeCard({
        checklists: [
          {
            ...checklist,
            items: [{ id: "item-1", text: "Oat milk", done: false }],
          },
        ],
      }),
    );
    const renameAction = {
      ...base,
      type: "RENAME_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      itemId: "item-1",
      text: "Oat milk",
    } as BoardAction;
    expect(commandDetails(renameAction, before, renamed)).toEqual({
      detail: "Oat milk",
      changes: [{ field: "checklistItem", from: "Milk", to: "Oat milk" }],
    });

    const checkAction = {
      ...base,
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      checklistId: "cl-1",
      itemId: "item-1",
      done: true,
    } as BoardAction;
    expect(commandDetails(checkAction, before, renamed)).toEqual({
      detail: "Milk",
      changes: [{ field: "checklistItemDone", from: "false", to: "true" }],
    });

    const deleteAction = {
      ...base,
      type: "DELETE_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      itemId: "item-1",
    } as BoardAction;
    expect(commandDetails(deleteAction, before, makeBoard())).toEqual({
      detail: "Milk",
      changes: [{ field: "checklistItem", from: "Milk", to: null }],
    });
  });

  it("has nothing to say about creates, archives and touches", () => {
    const before = makeBoard();
    const after = makeBoard();
    const actions: BoardAction[] = [
      { ...base, type: "TOUCH_CARD", cardId: "card-1" } as BoardAction,
      { ...base, type: "ARCHIVE_CARD", cardId: "card-1" } as BoardAction,
      {
        ...base,
        type: "ADD_CARD",
        columnId: "col-1",
        card: makeCard({ id: "card-2" }),
        newCardId: "card-2",
        title: "Copy",
      } as BoardAction,
    ];
    for (const action of actions) {
      expect(commandDetails(action, before, after)).toBeNull();
    }
  });
});
