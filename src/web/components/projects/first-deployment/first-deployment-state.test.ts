import { expect, test } from "bun:test";

import { firstDeploymentState } from "./first-deployment-state";

test.each([
  [
    "live",
    { hasLiveDeployment: true, hasActiveDeployment: true, approved: false, canDeploy: true },
  ],
  [
    "in-progress",
    { hasLiveDeployment: false, hasActiveDeployment: true, approved: false, canDeploy: true },
  ],
  [
    "awaiting-approval",
    { hasLiveDeployment: false, hasActiveDeployment: false, approved: false, canDeploy: true },
  ],
  [
    "ready",
    { hasLiveDeployment: false, hasActiveDeployment: false, approved: true, canDeploy: true },
  ],
  [
    "read-only",
    { hasLiveDeployment: false, hasActiveDeployment: false, approved: true, canDeploy: false },
  ],
] as const)("shows %s for %p", (expected, project) => {
  const state = firstDeploymentState(project);

  expect(state).toBe(expected);
});
