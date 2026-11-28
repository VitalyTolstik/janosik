import { LIMITS, type BoardAction } from "@janosik/shared";

import { createId } from "@/utils/id";

export function addAssignmentEpic(
  boardId: string,
  title: string,
  dispatch: (action: BoardAction) => void | Promise<boolean>,
): { id: string; result: void | Promise<boolean> } {
  const id = createId();
  const at = Date.now();
  return {
    id,
    result: dispatch({
      type: "ADD_EPIC",
      boardId,
      at,
      epic: {
        id,
        title: title.trim().slice(0, LIMITS.epicTitle),
        color: "rose",
        status: "active",
        position: 0,
        createdAt: at,
        updatedAt: at,
      },
    }),
  };
}
