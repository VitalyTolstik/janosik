/**
 * Shared text helpers used by both the reducer and the migration layer.
 */

/**
 * Clamp a text field to its length bound. The UI enforces the same limit
 * via `maxLength`; this is the second line of defense for callers that
 * bypass the inputs (imported JSON, console dispatches).
 */
export function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}
