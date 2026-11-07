const ACTIVE_REFRESH_INTERVAL_IN_MS = 3000;
const IDLE_REFRESH_INTERVAL_IN_MS = 15_000;
const ACTIVE_EXECUTION_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

/**
 * Keeps discovering scheduled executions after a task's earlier executions finish.
 *
 * @param executions - The executions currently loaded in the open history sheet.
 * @returns A faster interval for active executions, or the idle discovery interval, in milliseconds.
 */
export function taskHistoryRefreshInterval(
  executions: readonly { readonly status: string }[],
): number {
  return executions.some((execution) => ACTIVE_EXECUTION_STATUSES.has(execution.status))
    ? ACTIVE_REFRESH_INTERVAL_IN_MS
    : IDLE_REFRESH_INTERVAL_IN_MS;
}
