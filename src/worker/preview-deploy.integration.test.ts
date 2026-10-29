import { afterAll, describe, expect, test } from "bun:test";

import { getDeployment, requestDeployment } from "@/deployments";
import { openPreview } from "@/previews";

import { runDeployment } from "./deploy/deploy-runner";
import { createFixtureEnvironment } from "./integration-fixtures/fixture-environment";
import { type Cleanup, runCleanupsInReverse } from "./integration-fixtures/fixture-host";

// Builds and runs real containers, so the default `bun run test` ignores it. Run it with:
//   bun run test:docker
const NETWORK = `nelcota-it-previews-${Date.now()}`;
const CLEANUP_TIMEOUT_IN_MS = 120_000;
const TEST_TIMEOUT_IN_MS = 240_000;

type FixtureEnvironment = Awaited<ReturnType<typeof createFixtureEnvironment>>;

async function deploy(environment: FixtureEnvironment, previewId: string | null): Promise<string> {
  const { deploymentId } = requestDeployment(environment.database, {
    projectId: environment.project.id,
    trigger: "manual",
    actor: environment.actor,
    triggeredByUserId: null,
    previewId,
  });
  const status = await runDeployment(
    environment.dependencies,
    deploymentId,
    new AbortController().signal,
  );
  expect(status).toBe("succeeded");
  return getDeployment(environment.database, deploymentId).containerName ?? "";
}

async function isRunning(environment: FixtureEnvironment, containerName: string): Promise<boolean> {
  return (await environment.docker.inspectContainer(containerName))?.running === true;
}

describe("pull request previews with real Docker", () => {
  const cleanups: Cleanup[] = [];

  afterAll(async () => {
    await runCleanupsInReverse(cleanups);
  }, CLEANUP_TIMEOUT_IN_MS);

  test(
    "runs a preview next to production, and each new version replaces only its own",
    async () => {
      const environment = await createFixtureEnvironment(NETWORK, cleanups);
      const previewId = openPreview(environment.database, {
        projectId: environment.project.id,
        number: 7,
        branch: "main",
        headSha: "a".repeat(40),
      });

      const production = await deploy(environment, null);
      const preview = await deploy(environment, previewId);
      const nextProduction = await deploy(environment, null);

      expect(await isRunning(environment, preview)).toBe(true);
      expect(await isRunning(environment, nextProduction)).toBe(true);
      expect(await environment.docker.inspectContainer(production)).toBeNull();
    },
    TEST_TIMEOUT_IN_MS,
  );
});
