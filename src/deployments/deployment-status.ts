/** Every state a deployment can be in. */
export const DEPLOYMENT_STATUSES = [
  "queued",
  "cloning",
  "building",
  "starting",
  "health_checking",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Statuses of deployments waiting in the queue or running right now. */
export const ACTIVE_STATUSES: readonly DeploymentStatus[] = [
  "queued",
  "cloning",
  "building",
  "starting",
  "health_checking",
];

const TERMINAL_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Readonly<Record<DeploymentStatus, ReadonlySet<DeploymentStatus>>> = {
  // A rollback reuses an existing image and goes straight to "starting".
  queued: new Set(["cloning", "starting", "failed", "cancelled"]),
  cloning: new Set(["building", "queued", "failed", "cancelled"]),
  building: new Set(["starting", "queued", "failed", "cancelled"]),
  starting: new Set(["health_checking", "queued", "failed", "cancelled"]),
  health_checking: new Set(["succeeded", "queued", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

/** Thrown when code tries an impossible status change, which indicates a bug. */
export class InvalidDeploymentTransitionError extends Error {
  constructor(from: DeploymentStatus, to: DeploymentStatus) {
    super(`Deployment cannot go from ${from} to ${to}`);
    this.name = "InvalidDeploymentTransitionError";
  }
}

/**
 * Tells whether a deployment has finished.
 *
 * @param status - Current status.
 * @returns True for succeeded, failed and cancelled.
 */
export function isTerminalStatus(status: DeploymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Checks that a status change follows the deployment lifecycle.
 *
 * @remarks
 * Going back to "queued" only happens when a crashed worker's job is retried.
 *
 * @param from - Current status.
 * @param to - Next status.
 * @throws {InvalidDeploymentTransitionError} When the change is not allowed.
 */
export function assertDeploymentTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  if (ALLOWED_TRANSITIONS[from].has(to) === false) {
    throw new InvalidDeploymentTransitionError(from, to);
  }
}
