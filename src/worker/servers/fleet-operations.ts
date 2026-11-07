const MAX_FLEET_OPERATIONS = 4;

type Operation = {
  readonly run: () => Promise<void>;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
};

/** Owns bounded, deduplicated fleet I/O; disposal cancels queued work, never active ownership. */
export class FleetOperations implements Disposable {
  readonly #operations = new Map<string, Operation>();
  readonly #pending = new Map<string, Operation>();
  readonly #active = new Set<string>();
  #closed = false;

  run(key: string, run: () => Promise<void>): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    const existing = this.#operations.get(key);
    if (existing != null) {
      return existing.promise;
    }
    const result = Promise.withResolvers<void>();
    const operation = { run, ...result };
    this.#operations.set(key, operation);
    this.#pending.set(key, operation);
    this.#startPending();
    return result.promise;
  }

  #startPending(): void {
    while (this.#closed === false && this.#active.size < MAX_FLEET_OPERATIONS) {
      const next = this.#pending.entries().next().value;
      if (next == null) {
        return;
      }
      const [key, operation] = next;
      this.#pending.delete(key);
      this.#active.add(key);
      Promise.resolve()
        .then(async () => {
          if (this.#closed === false) {
            await operation.run();
          }
        })
        .then(operation.resolve, operation.reject)
        .finally(() => {
          this.#active.delete(key);
          this.#operations.delete(key);
          this.#startPending();
        });
    }
  }

  [Symbol.dispose](): void {
    this.#closed = true;
    for (const [key, operation] of this.#pending) {
      operation.resolve();
      this.#operations.delete(key);
    }
    this.#pending.clear();
  }
}
