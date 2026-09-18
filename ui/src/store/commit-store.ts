/**
 * Post-commit signal for the board's own commands (TASK-37): the history
 * view must refetch after the server has the row, not when the optimistic
 * state moves — that race is exactly one-behind (the fetch triggered by the
 * optimistic bump runs before the command commits and misses it). The
 * dispatcher publishes the touched card ids when a command settles;
 * comment writes keep using the activity store, whose frames the server
 * sends after their commit anyway.
 */
export class CommitStore {
  private readonly listeners = new Set<
    (boardId: string, cardIds: string[]) => void
  >();

  publish(boardId: string, cardIds: readonly string[]): void {
    if (cardIds.length === 0) return;
    for (const listener of [...this.listeners]) {
      listener(boardId, [...cardIds]);
    }
  }

  subscribe = (
    listener: (boardId: string, cardIds: string[]) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.listeners.clear();
  }
}
