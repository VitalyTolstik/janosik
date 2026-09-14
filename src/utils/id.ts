/**
 * Small dependency-free id generator. Uniqueness across a single board is
 * guaranteed by the timestamp + random suffix. Not cryptographically secure
 * (fine for localStorage data).
 */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
