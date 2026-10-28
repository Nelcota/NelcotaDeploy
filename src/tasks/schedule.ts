import { InvalidScheduleError } from "./task.errors";

/**
 * Computes the next time a cron schedule fires after a given instant.
 *
 * @param schedule - Five-field cron expression or nickname such as "@daily".
 * @param after - Instant to start from (exclusive).
 * @param timeZone - IANA zone the expression is written in.
 * @returns The next fire time.
 * @throws {InvalidScheduleError} When the expression is malformed or never fires.
 */
export function nextScheduledRun(schedule: string, after: Date, timeZone: string): Date {
  let next: Date | null;
  try {
    next = Bun.cron.parse(schedule, after, { tz: timeZone });
  } catch (error) {
    throw new InvalidScheduleError(
      schedule,
      error instanceof Error ? error.message : "unparseable",
    );
  }
  if (next == null) {
    throw new InvalidScheduleError(schedule, "it never fires");
  }
  return next;
}
