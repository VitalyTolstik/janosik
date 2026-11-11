import {
  boardReducer,
  type ApprovalPlan,
  type Board,
  type BoardAction,
} from "@janosik/shared";

/** Count each created card at its point in the plan, even if later deleted. */
export function countPlanCardCreates(plan: ApprovalPlan, board: Board): number {
  let running = board;
  let created = 0;
  for (const command of plan.commands ?? []) {
    const action = {
      ...command.action,
      boardId: plan.boardId,
      at: 0,
    } as BoardAction;
    const next =
      boardReducer([running], action, { withActivity: false })[0] ?? running;
    if (
      ["ADD_CARD", "DUPLICATE_CARD", "DUPLICATE_COLUMN"].includes(action.type)
    ) {
      for (const id of Object.keys(next.cards)) {
        if (!Object.hasOwn(running.cards, id)) created++;
      }
    }
    running = next;
  }
  return created;
}
