import { transitionDeployment } from "@/deployments";
import { containerNameFor, managedLabels, traefikLabels } from "@/docker";
import { listProjectDomains } from "@/domains";
import { getSystemSettings } from "@/settings";

import type { DeployContext, DeployRunnerDependencies } from "./deploy-context";

type ProjectDomain = ReturnType<typeof listProjectDomains>[number];

function containerLabels(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  domains: readonly ProjectDomain[],
): Record<string, string> {
  const { config } = dependencies;
  const { deployment, project } = context;
  const managed = managedLabels({
    projectId: project.id,
    projectSlug: project.slug,
    deploymentId: deployment.id,
  });
  if (config.traefik.enabled === false) {
    return managed;
  }
  return {
    ...managed,
    ...traefikLabels({
      projectSlug: project.slug,
      domains,
      internalPort: project.internalPort,
      network: config.network,
      httpEntrypoint: config.traefik.httpEntrypoint,
      httpsEntrypoint: config.traefik.httpsEntrypoint,
      certResolver: config.traefik.certResolver,
      compress: config.traefik.compress,
    }),
  };
}

function logRouting(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  domains: readonly ProjectDomain[],
): void {
  if (domains.length === 0) {
    return;
  }
  const hostnames = domains.map((domain) => domain.hostname).join(", ");
  if (dependencies.config.traefik.enabled) {
    context.logs.system(`Routing ${hostnames}`);
    return;
  }
  context.logs.system(`Proxy disabled; domains not routed: ${hostnames}`, "warn");
}

/**
 * Starts the new container next to the running one, attached to the proxy network.
 *
 * @param dependencies - Database, Docker and settings.
 * @param context - Deployment being run.
 * @param release - The `imageTag` to run, its `runtimeValues` (environment variables) and the
 *   `runtimeConfigHash` they were taken with.
 * @returns The new container name.
 */
export async function startContainer(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  release: {
    readonly imageTag: string;
    readonly runtimeValues: Readonly<Record<string, string>>;
    readonly runtimeConfigHash: string;
  },
): Promise<string> {
  const { database, docker, config } = dependencies;
  const { deployment, project, logs } = context;
  const containerName = containerNameFor(project.slug, deployment.id);
  transitionDeployment(database, deployment.id, {
    to: "starting",
    imageTag: release.imageTag,
    containerName,
    runtimeConfigHash: release.runtimeConfigHash,
  });
  logs.system(`Starting container ${containerName}`);
  await docker.ensureNetwork(config.network);
  const leftover = await docker.inspectContainer(containerName);
  if (leftover != null) {
    // Left behind by a previous attempt of this same deployment that crashed.
    await docker.removeContainer(containerName);
  }
  const domains = listProjectDomains(database, project.id, getSystemSettings(database));
  context.state.useContainer(containerName);
  await docker.runContainer(
    {
      containerName,
      imageTag: release.imageTag,
      network: config.network,
      labels: containerLabels(dependencies, context, domains),
      environmentKeys: Object.keys(release.runtimeValues),
    },
    release.runtimeValues,
  );
  logRouting(dependencies, context, domains);
  return containerName;
}
