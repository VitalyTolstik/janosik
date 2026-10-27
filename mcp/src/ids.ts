/**
 * Ids the command API requires the caller to mint (new card, column, label,
 * checklist, item, link) and the idempotency key for each command. The UI
 * uses `crypto.randomUUID()` for the same purpose, so ids stay the same
 * opaque shape on both sides.
 */
export function newId(): string {
  return crypto.randomUUID();
}

/** A fresh idempotency key for a command (≤64 chars, matches the DTO bound). */
export function newCommandId(): string {
  return `mcp-${crypto.randomUUID()}`;
}
