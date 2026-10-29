import { runtimeConfigFingerprint, transitionDeployment } from "@/deployments";
import { resolveEnvironment } from "@/environments";
import { readRepositoryToken } from "@/projects";
import { createRedactor } from "@/secrets";

import { networkProbes } from "../probes";
import { startContainer } from "./container-start";
import {
  assertNotCancelled,
  type DeployContext,
  type DeployRunnerDependencies,
  MILLISECONDS_PER_SECOND,
} from "./deploy-context";
import { waitUntilHealthy } from "./health-check";
import { buildFromSource, reuseImage } from "./image-source";

/**
 * Builds or reuses the image, starts the new container and waits until it is healthy.
 *
 * @param dependencies - Database, Docker, git, encryption and settings.
 * @param context - Deployment being run; its state records the container for cleanup.
 * @throws {DeploymentCancelledError} When the deployment is cancelled between steps.
 */
export async function deploy(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
): Promise<void> {
  const { database, docker, secretBox } = dependencies;
  const { deployment, project, logs, signal } = context;

  const environment = await resolveEnvironment(database, secretBox, project.id);
  // Taken with the variables it describes, so later edits show up as pending changes.
  const runtimeConfigHash = runtimeConfigFingerprint(database, project.id);
  const repositoryToken = await readRepositoryToken(database, secretBox, project.id);
  context.state.useRedactor(createRedactor([...environment.secretValues, repositoryToken ?? ""]));
  logs.useRedactor(context.state.redact);

  const reused =
    deployment.sourceDeploymentId == null ? null : await reuseImage(docker, deployment, logs);
  const imageTag =
    reused ??
    (await buildFromSource(dependencies, context, {
      buildValues: environment.build,
      repositoryToken,
    }));
  assertNotCancelled(signal);

  const containerName = await startContainer(dependencies, context, {
    imageTag,
    runtimeValues: environment.runtime,
    runtimeConfigHash,
  });
  await checkHealth(dependencies, context, containerName);
}

async function checkHealth(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  containerName: string,
): Promise<void> {
  const { database, docker, config } = dependencies;
  const { deployment, project, logs, signal } = context;
  transitionDeployment(database, deployment.id, { to: "health_checking" });
  const probe =
    project.healthCheckPath == null
      ? `TCP port ${project.internalPort}`
      : `HTTP ${project.healthCheckPath} on port ${project.internalPort}`;
  logs.system(`Waiting for the container to become healthy (${probe})`);
  await waitUntilHealthy(
    docker,
    {
      containerName,
      network: config.network,
      internalPort: project.internalPort,
      healthCheckPath: project.healthCheckPath,
      timeoutInMs: config.healthCheckTimeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal,
      onProgress: (message) => logs.system(message),
    },
    dependencies.probes ?? networkProbes,
  );
  logs.system("Health check passed");
}
