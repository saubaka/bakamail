/** Cancellation is not an authentication failure: guards must not clear a newer identity. */
export class SessionSupersededError extends Error {
  constructor() {
    super("会话读取已作废");
    this.name = "SessionSupersededError";
  }
}

/** Per-store runtime only; promises/controllers never enter persisted/reactive session state. */
export class SessionRequests<T> {
  generation = 0;
  pending: Promise<T> | null = null;
  private revision = 0;
  private controller: AbortController | null = null;
  private rejectCancellation: (() => void) | null = null;

  invalidate(): void {
    this.generation += 1;
    this.cancel();
  }

  private cancel(): void {
    this.revision += 1;
    this.controller?.abort();
    this.rejectCancellation?.();
    this.controller = null;
    this.rejectCancellation = null;
    this.pending = null;
  }

  run(fetcher: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
      settled: () => void, force = false): Promise<T> {
    if (this.pending && !force) return this.pending;
    if (force) this.cancel();
    const revision = ++this.revision;
    const controller = new AbortController();
    this.controller = controller;
    const cancellation = new Promise<never>((_resolve, reject) => {
      this.rejectCancellation = () => reject(new SessionSupersededError());
    });
    const job = Promise.resolve().then(() => {
      if (revision !== this.revision) throw new SessionSupersededError();
      return fetcher(controller.signal);
    });
    this.pending = Promise.race([job, cancellation]).then((value) => {
      if (revision !== this.revision) throw new SessionSupersededError();
      apply(value);
      return value;
    }).catch((error: unknown) => {
      if (revision !== this.revision) throw new SessionSupersededError();
      throw error;
    }).finally(() => {
      if (revision !== this.revision) return;
      this.pending = null;
      this.controller = null;
      this.rejectCancellation = null;
      settled();
    });
    return this.pending;
  }
}
