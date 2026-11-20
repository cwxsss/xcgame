/** Tracks admitted socket handlers while their asynchronous work settles. */
export class Drain {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();

  run<T>(action: () => T): T {
    if (this.closed) throw Error('serverRestarting');
    const result = action();
    if (result instanceof Promise) {
      this.pending.add(result);
      const done = () => this.pending.delete(result);
      void result.then(done, done);
    }
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.pending);
  }
}
