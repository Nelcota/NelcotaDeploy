import { transitionDeployment } from "@/deployments";
import { containerNameFor, volumeNameFor } from "@/docker";
import { listProjectDomains } from "@/domains";
import { getPreview, previewHostname, previewRouteName } from "@/previews";
import { projectRouteConfig } from "@/routing";
import { getSystemSettings } from "@/settings";
import { listMountedVolumes } from "@/volumes";

import {
  type DeployContext,
  type DeployRunnerConfig,
  type DeployRunnerDependencies,
  deploymentLabels,
} from "./deploy-context";

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
  context: Pick<DeployContext, "deployment" | "project" | "logs">,
  containerName: string,
): Promise<void> {
  const { routes, config } = dependencies;
  const { logs } = context;
  const target = routeTarget(dependencies.database, context);
  if (target.domains.length === 0) {
    await routes?.remove(target.fileName);
    return;
  }
  const hostnames = target.domains.map((domain) => domain.hostname).join(", ");
  if (routes == null) {
    logs.system(`Proxy disabled; domains not routed: ${hostnames}`, "warn");
    return;
  }
  await routes.write(
    target.fileName,
    projectRouteConfig({
      routeName: target.routeName,
      domains: target.domains,
      containerName,
      internalPort: context.project.internalPort,
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
 * Where a deployment's routes go: the project's domains for production, or the preview's own
 * address, in route files and routers that never overlap.
 */
function routeTarget(
  database: DeployRunnerDependencies["database"],
  { deployment, project }: Pick<DeployContext, "deployment" | "project">,
) {
  const settings = getSystemSettings(database);
  const preview = deployment.previewId == null ? null : getPreview(database, deployment.previewId);
  if (preview == null) {
    return {
      fileName: project.id,
      routeName: project.slug,
      domains: listProjectDomains(database, project.id, settings),
    };
  }
  const number = preview.pullRequestNumber;
  // Without a base domain a preview has no address; the webhook refuses to create one then.
  const domains =
    settings.baseDomain == null
      ? []
      : [
          {
            hostname: previewHostname(project.slug, number, settings.baseDomain),
            httpsEnabled: settings.httpsByDefault,
          },
        ];
  return {
    fileName: previewRouteName(project.id, number),
    routeName: `${project.slug}-pr-${number}`,
    domains,
  };
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
  // Previews never mount production's data.
  const volumes = deployment.previewId == null ? await prepareVolumes(dependencies, context) : [];
  context.state.useContainer(containerName);
  await docker.runContainer(
    {
      containerName,
      imageTag: release.imageTag,
      network: config.network,
      labels: deploymentLabels(context),
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
