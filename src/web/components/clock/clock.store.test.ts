import { expect, test } from "bun:test";

import { createClock } from "./clock.store";

const TICK_IN_MS = 1_000;

function createFakeScheduler() {
  const state = { onTick: null as (() => void) | null, starts: 0, stops: 0 };
  const timer = setInterval(() => undefined, TICK_IN_MS);
  clearInterval(timer);
  return {
    state,
    scheduler: {
      start: (onTick: () => void) => {
        state.onTick = onTick;
        state.starts += 1;
        return timer;
      },
      stop: () => {
        state.onTick = null;
        state.stops += 1;
      },
    },
  };
}

function createFakeTime(startInMs: number) {
  const time = { currentInMs: startInMs };
  return { time, readTime: () => new Date(time.currentInMs) };
}

test("createClock keeps the same snapshot between ticks", () => {
  const { scheduler } = createFakeScheduler();
  const { readTime } = createFakeTime(0);
  const clock = createClock({ tickInMs: TICK_IN_MS, readTime, scheduler });

  const first = clock.getSnapshot();
  const second = clock.getSnapshot();

  expect(second).toBe(first);
});

test("createClock refreshes the snapshot and notifies listeners on each tick", () => {
  const { state, scheduler } = createFakeScheduler();
  const { time, readTime } = createFakeTime(0);
  const clock = createClock({ tickInMs: TICK_IN_MS, readTime, scheduler });
  let notifications = 0;
  clock.subscribe(() => {
    notifications += 1;
  });

  time.currentInMs = 5_000;
  state.onTick?.();

  expect(notifications).toBe(1);
  expect(clock.getSnapshot().getTime()).toBe(5_000);
});

test("createClock refreshes a stale snapshot when the first listener subscribes", () => {
  const { scheduler } = createFakeScheduler();
  const { time, readTime } = createFakeTime(0);
  const clock = createClock({ tickInMs: TICK_IN_MS, readTime, scheduler });

  time.currentInMs = 60_000;
  clock.subscribe(() => undefined);

  expect(clock.getSnapshot().getTime()).toBe(60_000);
});

test("createClock runs one timer for many listeners and stops it after the last unsubscribes", () => {
  const { state, scheduler } = createFakeScheduler();
  const { readTime } = createFakeTime(0);
  const clock = createClock({ tickInMs: TICK_IN_MS, readTime, scheduler });

  const unsubscribeFirst = clock.subscribe(() => undefined);
  const unsubscribeSecond = clock.subscribe(() => undefined);
  unsubscribeFirst();
  const stopsWithOneListenerLeft = state.stops;
  unsubscribeSecond();

  expect(state.starts).toBe(1);
  expect(stopsWithOneListenerLeft).toBe(0);
  expect(state.stops).toBe(1);
});

test("createClock throws RangeError when the tick is zero", () => {
  expect(() => createClock({ tickInMs: 0 })).toThrow(RangeError);
});

test("createClock throws RangeError when the tick is not finite", () => {
  expect(() => createClock({ tickInMs: Number.NaN })).toThrow(RangeError);
});
