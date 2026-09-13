/**
 * Whether the "N characters left" counter is visible: only near the limit
 * (last ~20%, at least 10 chars) — a constant character count is noise.
 */
export function showRemaining(length: number, limit: number): boolean {
  return length > limit - Math.max(10, Math.round(limit * 0.2));
}
