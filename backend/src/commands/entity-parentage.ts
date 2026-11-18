import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Entity ids are global primary keys while commands are board-scoped, but a
 * same-board id also carries an owner: a checklist belongs to one card, a
 * checklist item to one checklist and a card link to its source card. The
 * writers upsert by id, so accepting an id whose owner differs silently
 * re-parents the victim's row (TASK-180.2 H2).
 *
 * These lookups expose the stored owner to the command layer. The layer
 * decides the policy: a command may revive a soft-deleted row only under the
 * same parent, while a fresh create of an id that is already live under the
 * same parent is a reducer no-op. TASK-176.9's admin
 * `assertAdminCardRelations` uses the same owner fields and error shape; keep
 * the `id_conflict`/`conflict:"id"` envelope in one place.
 */
export interface ChecklistParentage {
  id: string;
  cardId: string;
  deletedAt: Date | null;
}

export interface ChecklistItemParentage {
  id: string;
  checklistId: string;
  deletedAt: Date | null;
}

export interface CardLinkParentage {
  id: string;
  boardId: string;
  fromCardId: string;
  deletedAt: Date | null;
}

export async function loadChecklistParentage(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<ChecklistParentage[]> {
  if (ids.length === 0) return [];
  return tx.checklist.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, cardId: true, deletedAt: true },
  });
}

export async function loadChecklistItemParentage(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<ChecklistItemParentage[]> {
  if (ids.length === 0) return [];
  return tx.checklistItem.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, checklistId: true, deletedAt: true },
  });
}

export async function loadCardLinkParentage(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<CardLinkParentage[]> {
  if (ids.length === 0) return [];
  return tx.cardLink.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, boardId: true, fromCardId: true, deletedAt: true },
  });
}

/**
 * The shared refusal for a same-board parentage collision. TASK-176.9's
 * admin path already answers this exact shape; the command path must not
 * invent a second one.
 */
export function parentageConflict(field: string, message: string): never {
  throw new ConflictException({
    message,
    field,
    code: "id_conflict",
    conflict: "id",
  });
}
