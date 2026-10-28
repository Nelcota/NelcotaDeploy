/** Left-bar color of a list row for a project's current container. */
export type RowAccent = "none" | "success" | "warning" | "danger" | "progress" | "neutral";

/**
 * Picks the row accent from the observed container state.
 *
 * @param state - Docker state of the current container, or null when there is none.
 * @param health - Docker health status, when the image defines a HEALTHCHECK.
 * @returns Green when serving, amber while restarting, red when stopped or unhealthy, grey
 * when the project was never deployed.
 */
export function containerAccent(state: string | null, health: string | null): RowAccent {
  if (state == null) {
    return "neutral";
  }
  if (state === "running") {
    return health === "unhealthy" ? "danger" : "success";
  }
  if (state === "restarting") {
    return "warning";
  }
  return "danger";
}

/**
 * Picks the row accent for a deployment status.
 *
 * @param status - Deployment status.
 * @returns Green when succeeded, red when failed, grey when cancelled, blue while running.
 */
export function deploymentAccent(status: string): RowAccent {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "cancelled") {
    return "neutral";
  }
  return "progress";
}
