import type { Board, BoardAction } from "@janosik/shared";
import { applyCommandWrites } from "./command-writers";

/**
 * TASK-156 (items 2/43 follow-ups): the soft-delete writers must only restamp
 * rows that are part of *this* deletion. A historically deleted row keeps its
 * own `deletedAt` — restamping it shifts its retention window and makes a
 * later admin restore resurrect it as part of this operation.
 */
describe("command writers — soft-delete hygiene (TASK-156)", () => {
  const card = {
    id: "card-1",
    title: "C",
    labelIds: [],
    createdAt: 1,
    updatedAt: 2_000,
  };

  const boardOf = (cards: Record<string, unknown>): Board =>
    ({
      id: "board-1",
      title: "Board",
      columns: [],
      cards,
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    }) as unknown as Board;

  const ctxOf = (action: BoardAction, after: Board) => ({
    boardId: "board-1",
    action,
    before: after,
    after,
    at: 1_000,
    actorId: "user-1",
  });

  describe("DELETE_CHECKLIST", () => {
    it("loads and stamps only the checklist's live items", async () => {
      const action = {
        type: "DELETE_CHECKLIST",
        cardId: "card-1",
        checklistId: "cl-1",
        at: 1_000,
      } as unknown as BoardAction;
      // The mock answers what the *filtered* query returns: the live item
      // only — the previously deleted `item-gone` is invisible to it.
      const tx = {
        checklistItem: {
          findMany: jest.fn().mockResolvedValue([{ id: "item-live" }]),
          updateMany: jest.fn(),
        },
        checklist: { update: jest.fn() },
        card: { update: jest.fn() },
        board: { update: jest.fn() },
      };

      const touches = await applyCommandWrites(
        tx as never,
        ctxOf(action, boardOf({ "card-1": card })),
      );

      expect(tx.checklistItem.findMany).toHaveBeenCalledWith({
        where: { checklistId: "cl-1", deletedAt: null },
        select: { id: true },
      });
      expect(tx.checklistItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["item-live"] } },
        data: { deletedAt: new Date(1_000), version: { increment: 1 } },
      });
      expect(touches).toEqual([
        "board:board-1",
        "card:card-1",
        "checklist:cl-1",
        "checklistItem:item-live",
      ]);
    });
  });

  describe("DELETE_LABEL", () => {
    it("hard-deletes only the links of live/archived cards", async () => {
      const action = {
        type: "DELETE_LABEL",
        labelId: "label-1",
        at: 1_000,
      } as unknown as BoardAction;
      const tx = {
        cardLabel: {
          findMany: jest.fn().mockResolvedValue([{ cardId: "card-live" }]),
          deleteMany: jest.fn(),
        },
        label: { update: jest.fn() },
        board: { update: jest.fn() },
      };

      const touches = await applyCommandWrites(
        tx as never,
        ctxOf(action, boardOf({ "card-1": card })),
      );

      // The reducer removes labelIds only from cards in its state — live
      // and archived ones. A soft-deleted card is not in that state: its
      // join rows are the restore record (DELETE_CARD keeps them too), and
      // hard-deleting them here would strip the label from a revived card.
      expect(tx.cardLabel.findMany).toHaveBeenCalledWith({
        where: { labelId: "label-1", card: { deletedAt: null } },
        select: { cardId: true },
      });
      expect(tx.cardLabel.deleteMany).toHaveBeenCalledWith({
        where: { labelId: "label-1", card: { deletedAt: null } },
      });
      expect(tx.label.update).toHaveBeenCalledWith({
        where: { id: "label-1" },
        data: { deletedAt: new Date(1_000), version: { increment: 1 } },
      });
      expect(touches).toEqual([
        "board:board-1",
        "label:label-1",
        "card:card-live",
      ]);
    });
  });
});
