export const ADMIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Structural filters accepted by card links and the cards list. */
export const ADMIN_CARD_SCOPE = [
  "boardId",
  "columnId",
  "labelId",
  "cardId",
] as const;

export function parseAdminFilterId(
  value: unknown,
  pattern = ADMIN_ID_PATTERN,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : undefined;
}
