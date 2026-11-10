/**
 * TASK-166.6: a small process-local serial queue. The account bundle builder
 * uses it to avoid two large JSON trees in memory at once. This is explicitly
 * per-process; a multi-node deployment can still build one bundle per node.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
