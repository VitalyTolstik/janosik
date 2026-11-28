import { LIMITS } from "@janosik/shared";

import type { useBoardActions } from "@/store/BoardContext";
import { createId } from "@/utils/id";

export function addAssignmentEpic(
  boardId: string,
  title: string,
  dispatchEpicCreation: ReturnType<
    typeof useBoardActions
  >["dispatchEpicCreation"],
  cardIds: readonly string[],
  signal?: AbortSignal,
) {
  const at = Date.now();
  return dispatchEpicCreation(
    {
      type: "ADD_EPIC",
      boardId,
      at,
      epic: {
        id: createId(),
        title: title.trim().slice(0, LIMITS.epicTitle),
        color: "rose",
        status: "active",
        position: 0,
        createdAt: at,
        updatedAt: at,
      },
    },
    cardIds,
    signal,
  );
}
