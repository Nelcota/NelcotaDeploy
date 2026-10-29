import {
  buildConfigFingerprint,
  runtimeConfigFingerprint,
  transitionDeployment,
} from "@/deployments";
import { resolveEnvironment } from "@/environments";
import { appCloneToken } from "@/github";
import { readRepositoryToken } from "@/projects";
import { createRedactor } from "@/secrets";

import { networkProbes } from "../probes";
import { routeTrafficTo, startContainer } from "./container-start";
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

  const environment = await resolveEnvironment(database, secretBox, {
    projectId: project.id,
    forPreview: deployment.previewId != null,
  });
  // Taken with the variables it describes, so later edits show up as pending changes.
  const runtimeConfigHash = runtimeConfigFingerprint(database, project.id);
  const buildConfigHash = buildConfigFingerprint(database, project.id);
  const repositoryToken = await cloneToken(dependencies, context);
  context.state.useRedactor(createRedactor([...environment.secretValues, repositoryToken ?? ""]));
  logs.useRedactor(context.state.redact);

  const reused =
    deployment.sourceDeploymentId == null ? null : await reuseImage(docker, deployment, logs);
  const built =
    reused == null
      ? await buildFromSource(dependencies, context, {
          buildValues: environment.build,
          repositoryToken,
        })
      : { imageTag: reused, detectedPort: null };
  assertNotCancelled(signal);

  // Routing and the health check use the port this build found in the Dockerfile.
  const running: DeployContext =
    built.detectedPort == null
      ? context
      : { ...context, project: { ...project, internalPort: built.detectedPort } };
  const containerName = await startContainer(dependencies, running, {
    imageTag: built.imageTag,
    runtimeValues: environment.runtime,
    runtimeConfigHash,
    // A reused image keeps the build variables it was built with, copied from its source.
    buildConfigHash: reused == null ? buildConfigHash : null,
  });
  await checkHealth(dependencies, running, containerName);
  await routeTrafficTo(dependencies, running, containerName);
}

/** A token saved on the project wins; otherwise the GitHub App provides one when installed. */
async function cloneToken(
  { database, secretBox }: DeployRunnerDependencies,
  { deployment, project, logs }: DeployContext,
): Promise<string | null> {
  const savedToken = await readRepositoryToken(database, secretBox, project.id);
  // Reusing an image clones nothing.
  if (savedToken != null || deployment.sourceDeploymentId != null) {
    return savedToken;
  }
  return await appCloneToken(database, secretBox, project.repositoryFullName).catch(
    (error: unknown) => {
      // A public repository still clones without a token, so the deploy goes on.
      logs.system(`Could not get a token from the GitHub App: ${String(error)}`);
      return null;
    },
  );
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
