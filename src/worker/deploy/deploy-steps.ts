import {
  buildConfigFingerprint,
  runtimeConfigFingerprint,
  transitionDeployment,
} from "@/deployments";
import { readDeploymentSecrets, resolveEnvironment, saveDeploymentSecrets } from "@/environments";
import { appCloneToken } from "@/github";
import { readRepositoryToken } from "@/projects";
import { createRedactor } from "@/secrets";
import type { ProjectBuilder } from "@/shared/schemas/project.schema";

import { networkProbes } from "../probes";
import { deployCompose } from "./compose/compose-deploy";
import { routeTrafficTo, startContainers } from "./container-start";
import {
  assertDeployActive,
  type DeployContext,
  type DeployRunnerDependencies,
  MILLISECONDS_PER_SECOND,
} from "./deploy-context";
import { waitUntilHealthy } from "./health-check";
import { buildFromSource, buildStrategyFor, reuseImage } from "./image-source";

/**
 * Builds or reuses the image, starts the new replicas, waits until all are healthy and routes
 * traffic to them.
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
  const { deployment, project, logs } = context;
  const strategy = buildStrategyFor(project.builder);

  // Read the fingerprints before yielding to decryption: a later edit must remain pending.
  const runtimeConfigHash = runtimeConfigFingerprint(database, project.id);
  const buildConfigHash = buildConfigFingerprint(database, project.id);
  const environment = await resolveEnvironment(database, secretBox, {
    projectId: project.id,
    forPreview: deployment.previewId != null,
  });
  const reused =
    strategy.reusesPreviousImage === false || deployment.sourceDeploymentId == null
      ? null
      : await reuseImage(docker, deployment, logs);
  const repositoryToken = reused == null ? await cloneToken(dependencies, context) : null;
  const sourceSecrets = await readDeploymentSecrets(
    database,
    secretBox,
    deployment.sourceDeploymentId,
  );
  const secretValues = [...environment.secretValues, ...(sourceSecrets ?? [])];
  await saveDeploymentSecrets(database, secretBox, {
    deploymentId: deployment.id,
    values: secretValues,
  });
  context.state.useRedactor(createRedactor([...secretValues, repositoryToken ?? ""]));
  logs.useRedactor(context.state.redact);

  if (strategy.managesReplicaContainers === false) {
    // Compose always builds the commit: redeploys and rollbacks have no single image to reuse.
    const routed = await deployCompose(dependencies, context, {
      runtimeValues: environment.runtime,
      buildValues: environment.build,
      repositoryToken,
      runtimeConfigHash,
      buildConfigHash,
    });
    context.assertOwnership();
    await checkHealth(dependencies, context, routed);
    context.assertOwnership();
    await routeTrafficTo(dependencies, context, routed);
    return;
  }

  if (reused != null && deployment.internalPort == null) {
    throw new Error(
      "Cannot reuse a legacy image without its recorded container port; run a new deployment first",
    );
  }
  const built =
    reused == null
      ? await buildFromSource(dependencies, context, {
          buildValues: environment.build,
          repositoryToken,
        })
      : { imageTag: reused, detectedPort: deployment.internalPort };
  assertDeployActive(context);

  // Routing and the health check use the port this build found in the Dockerfile.
  const running: DeployContext =
    built.detectedPort == null
      ? context
      : { ...context, project: { ...project, internalPort: built.detectedPort } };
  const containerNames = await startContainers(dependencies, running, {
    imageTag: built.imageTag,
    runtimeValues: withPortVariable(environment.runtime, running.project),
    runtimeConfigHash,
    // A reused image keeps the build variables it was built with, copied from its source.
    buildConfigHash: reused == null ? buildConfigHash : null,
  });
  context.assertOwnership();
  await checkHealth(dependencies, running, containerNames);
  context.assertOwnership();
  await routeTrafficTo(dependencies, running, containerNames);
}

/**
 * Adds `PORT` with the container port for images Railpack built, which most frameworks read to
 * know where to listen. A `PORT` the project defines itself wins.
 *
 * @param values - Runtime variables of the project.
 * @param project - Its builder and container port.
 * @returns The variables the container starts with.
 */
export function withPortVariable(
  values: Readonly<Record<string, string>>,
  project: { readonly builder: ProjectBuilder; readonly internalPort: number },
): Readonly<Record<string, string>> {
  return buildStrategyFor(project.builder).runtimeVariables(values, project.internalPort);
}

/** A token saved on the project wins; otherwise the GitHub App provides one when installed. */
async function cloneToken(
  { database, secretBox }: DeployRunnerDependencies,
  { project, logs }: DeployContext,
): Promise<string | null> {
  const savedToken = await readRepositoryToken(database, secretBox, project.id);
  if (savedToken != null) {
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

// Every replica must pass before traffic moves, so a broken one never receives requests.
async function checkHealth(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  containerNames: readonly string[],
): Promise<void> {
  const { database } = dependencies;
  const { deployment, project, logs } = context;
  transitionDeployment(database, deployment.id, { to: "health_checking" });
  const probe =
    project.healthCheckPath == null
      ? `TCP port ${project.internalPort}`
      : `HTTP ${project.healthCheckPath} on port ${project.internalPort}`;
  const subject = containerNames.length === 1 ? "the container" : "the replicas";
  logs.system(`Waiting for ${subject} to become healthy (${probe})`);
  const checks = await Promise.allSettled(
    containerNames.map(
      async (containerName) =>
        await checkReplicaHealth(dependencies, context, {
          containerName,
          // With several replicas, each progress line says which one it is about.
          prefix: containerNames.length === 1 ? "" : `${containerName}: `,
        }),
    ),
  );
  const failed = checks.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
  logs.system("Health check passed");
}

async function checkReplicaHealth(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  replica: { readonly containerName: string; readonly prefix: string },
): Promise<void> {
  const { docker, config } = dependencies;
  const { project, logs, signal } = context;
  await waitUntilHealthy(
    docker,
    {
      containerName: replica.containerName,
      network: config.network,
      internalPort: project.internalPort,
      healthCheckPath: project.healthCheckPath,
      timeoutInMs: config.healthCheckTimeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal,
      onProgress: (message) => logs.system(`${replica.prefix}${message}`),
    },
    dependencies.probes ?? networkProbes,
  );
}
