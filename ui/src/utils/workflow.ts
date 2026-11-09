import {
  evaluateCardTransition,
  evaluateTransition,
  isColumnFull,
  LIMITS,
  type Board,
  type BoardRole,
  type BoardWorkflow,
  type Card,
  type Column,
  type WorkflowCondition,
} from "@janosik/shared";
import type { MessageKey } from "@/i18n";

type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

/** Localized name of one workflow condition. */
export function conditionLabel(
  condition: WorkflowCondition,
  t: Translate,
): string {
  return t(`workflow.condition.${condition}`);
}

/** Why a move target is unavailable right now, or `null` when it is allowed. */
export interface MoveTargetContext {
  workflow?: BoardWorkflow;
  card: Card;
  fromColumnId: string;
  fromTitle: string;
  target: Column;
  role?: BoardRole;
}

/**
 * The single reason text shared by the drag layer, the card menus, the card
 * dialog and the table. Workflow is checked before WIP, matching the server:
 * a forbidden transition must not be reported as "column full".
 */
export function moveTargetBlockReason(
  context: MoveTargetContext,
  t: Translate,
): string | null {
  const workflowReason = workflowBlockReason(context, t);
  if (workflowReason !== null) return workflowReason;
  const { target, fromColumnId } = context;
  if (target.id === fromColumnId) return null;
  if (isColumnFull(target)) {
    return target.wipLimit !== undefined
      ? t("workflow.blocked.wip", {
          title: target.title,
          limit: target.wipLimit,
        })
      : t("limits.maxItems", { limit: LIMITS.cardsPerColumn });
  }
  return null;
}

/** Workflow-only part of {@link moveTargetBlockReason} (drag pre-check). */
export function workflowBlockReason(
  context: MoveTargetContext,
  t: Translate,
): string | null {
  const { workflow, card, fromColumnId, fromTitle, target, role } = context;
  if (target.id === fromColumnId) return null;
  const decision = evaluateCardTransition(
    workflow,
    card,
    fromColumnId,
    target.id,
    role,
  );
  if (decision.allowed) return null;
  if (decision.code === "role_not_allowed") {
    return t("workflow.blocked.role", {
      from: fromTitle,
      to: target.title,
      roles: (decision.requiredRoles ?? []).join(" / "),
    });
  }
  if (decision.code === "condition_failed") {
    return t("workflow.blocked.condition", {
      conditions: decision.failedConditions
        .map((condition) => conditionLabel(condition, t))
        .join(t("workflow.conditionSeparator")),
    });
  }
  return t("workflow.blocked.transition", {
    from: fromTitle,
    to: target.title,
  });
}

/** The same reason for a card looked up on the board (drag/menu paths). */
export function boardMoveBlockReason(
  board: Board,
  cardId: string,
  target: Column,
  role: BoardRole | undefined,
  t: Translate,
): string | null {
  const card = board.cards[cardId];
  const from = board.columns.find((column) => column.cardIds.includes(cardId));
  if (!card || !from) return t("card.notFound");
  return moveTargetBlockReason(
    {
      workflow: board.workflow,
      card,
      fromColumnId: from.id,
      fromTitle: from.title,
      target,
      role,
    },
    t,
  );
}

/**
 * Why an archived card may not be restored into `target`. Restoring is a
 * column change exactly like a move: the card may return to its original
 * column, and any other target must be reachable under the workflow. A card
 * archived before the field existed has no known source; the server still
 * checks it (a 409 with the same machine details), so the menu stays usable.
 */
export function restoreTargetBlockReason(
  board: Board,
  card: Card,
  target: Column,
  role: BoardRole | undefined,
  t: Translate,
): string | null {
  const sourceId = card.archivedFromColumnId;
  const sourceTitle = sourceId
    ? board.columns.find((column) => column.id === sourceId)?.title
    : undefined;
  if (sourceId !== undefined && sourceTitle !== undefined) {
    const reason = moveTargetBlockReason(
      {
        workflow: board.workflow,
        card,
        fromColumnId: sourceId,
        fromTitle: sourceTitle,
        target,
        role,
      },
      t,
    );
    if (reason !== null) return reason;
  }
  if (isColumnFull(target)) {
    return target.wipLimit !== undefined
      ? t("workflow.blocked.wip", {
          title: target.title,
          limit: target.wipLimit,
        })
      : t("limits.maxItems", { limit: LIMITS.cardsPerColumn });
  }
  return null;
}

/**
 * Toast copy for a blocked drag/menu move: the reason plus the destination
 * titles still available, so the user never has to guess. WIP-full targets
 * are filtered out — the workflow may allow them, but the move would still
 * be refused.
 */
export function blockedMoveMessage(
  board: Board,
  cardId: string,
  target: Column,
  role: BoardRole | undefined,
  t: Translate,
): string {
  const reason = boardMoveBlockReason(board, cardId, target, role, t);
  if (reason === null) return "";
  const decision = evaluateTransition(board, cardId, target.id, role);
  if (decision.allowed || decision.allowedToColumnIds.length === 0) {
    return reason;
  }
  const titles = decision.allowedToColumnIds
    .map((id) => board.columns.find((column) => column.id === id))
    .filter(
      (column): column is Column =>
        column !== undefined && !isColumnFull(column),
    )
    .map((column) => column.title);
  if (titles.length === 0) return reason;
  return `${reason} ${t("workflow.blocked.available", {
    columns: titles.join(t("workflow.listSeparator")),
  })}`;
}
