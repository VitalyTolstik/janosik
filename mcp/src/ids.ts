import { createHash } from "node:crypto";

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

/** A stable, bounded idempotency key for one operation on a client id. */
export function stableCommandId(entityId: string, operation: string): string {
  if (operation === "create" && entityId.length <= 64) return entityId;
  const digest = createHash("sha256")
    .update(`${operation}:${entityId}`)
    .digest("hex");
  return `mcp-${digest.slice(0, 60)}`;
}
