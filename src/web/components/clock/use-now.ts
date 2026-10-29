import { useSyncExternalStore } from "react";

import { createClock } from "./clock.store";

/** Relative times ("há 2 min") only need to move about this often. */
const NOW_TICK_IN_MS = 30_000;

const clock = createClock({ tickInMs: NOW_TICK_IN_MS });

/**
 * Returns the current time, refreshed every 30 seconds, without calling `new Date()` during
 * render. All components share one timer.
 */
export function useNow(): Date {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
