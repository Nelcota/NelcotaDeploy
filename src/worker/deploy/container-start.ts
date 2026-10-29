import { transitionDeployment } from "@/deployments";
import { containerNameFor, managedLabels, volumeNameFor } from "@/docker";
import { listProjectDomains } from "@/domains";
import { projectRouteConfig } from "@/routing";
import { getSystemSettings } from "@/settings";
import { listMountedVolumes } from "@/volumes";

import type { DeployContext, DeployRunnerConfig, DeployRunnerDependencies } from "./deploy-context";

/**
 * Points the project's routes at the new container, alone, once it is healthy. Requests that
 * already reached the old container finish there; new ones go to the new container.
 *
 * @param dependencies - Database, route files and settings.
 * @param context - Deployment being run.
 * @param containerName - The healthy new container.
 * @throws {RouteFileError} When the routes cannot be written on the server.
 * @throws {InvalidRouteError} When a hostname or name could not go into the routes.
 */
export async function routeTrafficTo(
  dependencies: Pick<DeployRunnerDependencies, "database" | "routes"> & {
    readonly config: Pick<DeployRunnerConfig, "routingSettleInMs" | "traefik">;
  },
  context: Pick<DeployContext, "project" | "logs">,
  containerName: string,
): Promise<void> {
  const { database, routes, config } = dependencies;
  const { project, logs } = context;
  const domains = listProjectDomains(database, project.id, getSystemSettings(database));
  if (domains.length === 0) {
    await routes?.remove(project.id);
    return;
  }
  const hostnames = domains.map((domain) => domain.hostname).join(", ");
  if (routes == null) {
    logs.system(`Proxy disabled; domains not routed: ${hostnames}`, "warn");
    return;
  }
  await routes.write(
    project.id,
    projectRouteConfig({
      projectSlug: project.slug,
      domains,
      containerName,
      internalPort: project.internalPort,
      entrypoints: {
        http: config.traefik.httpEntrypoint,
        https: config.traefik.httpsEntrypoint,
        certResolver: config.traefik.certResolver,
      },
      compress: config.traefik.compress,
    }),
  );
  logs.system(`Routing ${hostnames} to ${containerName}`);
  // The proxy applies new routes after a short delay; the old container must still answer.
  await Bun.sleep(config.routingSettleInMs);
}

/**
 * Starts the new container next to the running one, attached to the proxy network. It gets
 * no traffic until {@link routeTrafficTo} switches the routes to it.
 *
 * @param dependencies - Database, Docker and settings.
 * @param context - Deployment being run.
 * @param release - The `imageTag` to run, its `runtimeValues` (environment variables) and the
 *   `runtimeConfigHash` they were taken with, and the `buildConfigHash` of a new build.
 * @returns The new container name.
 */
export async function startContainer(
  dependencies: Pick<DeployRunnerDependencies, "database" | "docker"> & {
    readonly config: Pick<DeployRunnerConfig, "network">;
  },
  context: Pick<DeployContext, "deployment" | "project" | "logs" | "state">,
  release: {
    readonly imageTag: string;
    readonly runtimeValues: Readonly<Record<string, string>>;
    readonly runtimeConfigHash: string;
    /** Null when the image was reused, which keeps the hash copied from its source. */
    readonly buildConfigHash: string | null;
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
    ...(release.buildConfigHash == null ? {} : { buildConfigHash: release.buildConfigHash }),
  });
  logs.system(`Starting container ${containerName}`);
  await docker.ensureNetwork(config.network);
  const leftover = await docker.inspectContainer(containerName);
  if (leftover != null) {
    // Left behind by a previous attempt of this same deployment that crashed.
    await docker.removeContainer(containerName);
  }
  const volumes = await prepareVolumes(dependencies, context);
  context.state.useContainer(containerName);
  await docker.runContainer(
    {
      containerName,
      imageTag: release.imageTag,
      network: config.network,
      labels: managedLabels({
        projectId: project.id,
        projectSlug: project.slug,
        deploymentId: deployment.id,
      }),
      environmentKeys: Object.keys(release.runtimeValues),
      volumes,
    },
    release.runtimeValues,
  );
  return containerName;
}

/** Creates the project's attached volumes on the server when missing and lists their mounts. */
async function prepareVolumes(
  { database, docker }: Pick<DeployRunnerDependencies, "database" | "docker">,
  { project, logs }: Pick<DeployContext, "project" | "logs">,
): Promise<{ name: string; target: string }[]> {
  const mounts = listMountedVolumes(database, project.id).map((volume) => ({
    name: volumeNameFor(volume.id),
    target: volume.mountPath,
  }));
  await Promise.all(
    mounts.map(async (mount) => await docker.volumes.ensure(mount.name, project.id)),
  );
  for (const mount of mounts) {
    logs.system(`Mounting volume ${mount.name} at ${mount.target}`);
  }
  return mounts;
}
