type IntervalTimer = ReturnType<typeof setInterval>;

/** Starts and stops the repeating timer that drives a clock; injectable for tests. */
type IntervalScheduler = {
  readonly start: (onTick: () => void, intervalInMs: number) => IntervalTimer;
  readonly stop: (timer: IntervalTimer) => void;
};

type ClockOptions = {
  readonly tickInMs: number;
  readonly readTime?: () => Date;
  readonly scheduler?: IntervalScheduler;
};

/** A ticking "now" shaped for `useSyncExternalStore`. */
export type ClockStore = {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => Date;
};

const browserScheduler: IntervalScheduler = {
  start: (onTick, intervalInMs) => setInterval(onTick, intervalInMs),
  stop: (timer) => clearInterval(timer),
};

/**
 * Creates a clock shared by every subscriber: one timer runs only while someone listens, and
 * the snapshot stays the same `Date` between ticks so React does not re-render in a loop.
 *
 * @throws {RangeError} When `tickInMs` is not a positive finite number.
 */
export function createClock({
  tickInMs,
  readTime = () => new Date(),
  scheduler = browserScheduler,
}: ClockOptions): ClockStore {
  if (Number.isFinite(tickInMs) === false || tickInMs <= 0) {
    throw new RangeError(`tickInMs must be a positive number, received ${tickInMs}`);
  }

  let snapshot = readTime();
  const listeners = new Set<() => void>();
  let timer: IntervalTimer | null = null;

  const tick = () => {
    snapshot = readTime();
    for (const listener of listeners) {
      listener();
    }
  };

  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    if (timer == null) {
      // The snapshot may be stale after a period without listeners.
      snapshot = readTime();
      timer = scheduler.start(tick, tickInMs);
    }
    return () => {
      listeners.delete(onChange);
      if (listeners.size === 0 && timer != null) {
        scheduler.stop(timer);
        timer = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => snapshot };
}
