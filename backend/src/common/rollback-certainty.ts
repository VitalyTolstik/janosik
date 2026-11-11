/** Marks errors known to have happened before a transaction could commit. */
const rolledBack = new WeakSet<object>();

export function markGuaranteedRollback(error: unknown): void {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    rolledBack.add(error as object);
  }
}

export function isGuaranteedRollback(error: unknown): boolean {
  return typeof error === "object" && error !== null && rolledBack.has(error);
}

export function beforeWrite<T extends Error>(error: T): T {
  markGuaranteedRollback(error);
  return error;
}

export async function rollbackOnThrow<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    markGuaranteedRollback(error);
    throw error;
  }
}
