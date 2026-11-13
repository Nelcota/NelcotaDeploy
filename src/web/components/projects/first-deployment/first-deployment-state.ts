/** Chooses the next step before the first version is live. */
export function firstDeploymentState({
  hasLiveDeployment,
  hasActiveDeployment,
  approved,
  canDeploy,
}: {
  readonly hasLiveDeployment: boolean;
  readonly hasActiveDeployment: boolean;
  readonly approved: boolean;
  readonly canDeploy: boolean;
}) {
  if (hasLiveDeployment) {
    return "live";
  }

  if (hasActiveDeployment) {
    return "in-progress";
  }

  if (approved === false) {
    return "awaiting-approval";
  }

  return canDeploy ? "ready" : "read-only";
}
