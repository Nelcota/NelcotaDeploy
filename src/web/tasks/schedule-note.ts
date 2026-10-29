/** Second line under a task's schedule: when it runs next, or why it does not run. */
type ScheduleNote = { readonly kind: "next"; readonly at: string } | { readonly kind: "paused" };

/**
 * Picks the note shown under a scheduled task.
 *
 * @param task - Whether the task is enabled and its next run as a UTC ISO date.
 * @returns The next run for an enabled task that has one, "paused" for a disabled task, or
 * null when there is nothing to add.
 */
export function scheduleNote(task: {
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
}): ScheduleNote | null {
  if (task.enabled === false) {
    return { kind: "paused" };
  }
  return task.nextRunAt == null ? null : { kind: "next", at: task.nextRunAt };
}
