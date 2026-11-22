import type { BoardRole } from "@janosik/shared";

/**
 * TASK-177.4 decision 1: a board ADMIN and MEMBER may edit/clear the card's
 * task spec; a VIEWER and a public read-only mount may not.
 */
export function canEditCardTaskSpec(
  role: BoardRole | undefined,
  readOnly: boolean,
): boolean {
  return !readOnly && (role === "ADMIN" || role === "MEMBER");
}

/**
 * TASK-177.4 decision 1: releasing a claim is available to its owner and to
 * a board ADMIN. The server enforces the same rule; a VIEWER or read-only
 * surface never gets the control.
 */
export function canReleaseCardClaim({
  role,
  userId,
  claimedBy,
  readOnly,
}: {
  role: BoardRole | undefined;
  userId: string | null | undefined;
  claimedBy: string | undefined;
  readOnly: boolean;
}): boolean {
  if (readOnly || role === undefined || role === "VIEWER") return false;
  return role === "ADMIN" || (userId != null && userId === claimedBy);
}
