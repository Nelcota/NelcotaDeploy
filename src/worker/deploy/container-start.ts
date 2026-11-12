import {
  DeploymentCancelledError,
  isCancellationRequested,
  requireActivePreview,
  transitionDeployment,
} from "@/deployments";
import { replicaContainerNameFor, volumeNameFor } from "@/docker";
import { listProjectDomains } from "@/domains";
import { previewHostname, previewRouteName } from "@/previews";
import { projectRouteConfig } from "@/routing";
import { getSystemSettings } from "@/settings";
import { listMountedVolumes } from "@/volumes";

import {
  assertDeployActive,
  type DeployContext,
  type DeployRunnerConfig,
  type DeployRunnerDependencies,
  deploymentLabels,
} from "./deploy-context";

/**
 * Points the project's routes at the new replicas, alone, once they are healthy. Requests that
 * already reached the old containers finish there; new ones are balanced between the new
 * replicas.
 *
 * @param dependencies - Database, route files and settings.
 * @param context - Deployment being run.
 * @param containerNames - The healthy new replicas.
 * @throws {RouteFileError} When the routes cannot be written on the server.
 * @throws {InvalidRouteError} When a hostname or name could not go into the routes.
 * @throws {PreviewNotActiveError} When the target preview has closed or is missing.
 */
export async function routeTrafficTo(
  dependencies: Pick<DeployRunnerDependencies, "database" | "routes"> & {
    readonly config: Pick<DeployRunnerConfig, "routingSettleInMs" | "traefik">;
  },
  context: Pick<
    DeployContext,
    "deployment" | "project" | "logs" | "assertOwnership" | "signal" | "state"
  >,
  containerNames: readonly string[],
): Promise<void> {
  const { routes, config } = dependencies;
  const { logs, state } = context;
  assertDeployActive(context);
  let target = routeTarget(dependencies.database, context);
  if (routes != null && context.deployment.previewId != null) {
    const restore = await routes.snapshot(target.fileName);
    assertDeployActive(context);
    target = routeTarget(dependencies.database, context);
    state.restorePreviewRoute = restore;
  }

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
      containerNames,
      internalPort: context.project.internalPort,
      entrypoints: {
        http: config.traefik.httpEntrypoint,
        https: config.traefik.httpsEntrypoint,
        certResolver: config.traefik.certResolver,
      },
      compress: config.traefik.compress,
    }),
  );
  logs.system(`Routing ${hostnames} to ${containerNames.join(", ")}`);
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
  if (deployment.previewId == null) {
    return {
      fileName: project.id,
      routeName: project.slug,
      domains: listProjectDomains(database, project.id, settings),
    };
  }

  if (isCancellationRequested(database, deployment.id)) {
    throw new DeploymentCancelledError();
  }

  const { pullRequestNumber: number } = requireActivePreview(
    database,
    project.id,
    deployment.previewId,
  );
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
 * How many containers a deployment runs: the project's replicas in production, one for a pull
 * request preview, which is only there to be looked at.
 *
 * @param context - Deployment being run and its project.
 * @returns The number of replicas, at least one.
 */
export function replicaCountOf(context: Pick<DeployContext, "deployment" | "project">): number {
  if (context.deployment.previewId != null) {
    return 1;
  }
  return Math.max(1, context.project.replicas);
}

/**
 * Starts the new replicas next to the running containers, attached to the proxy network. They
 * get no traffic until {@link routeTrafficTo} switches the routes to them.
 *
 * @param dependencies - Database, Docker and settings.
 * @param context - Deployment being run.
 * @param release - The `imageTag` to run, its `runtimeValues` (environment variables) and the
 *   `runtimeConfigHash` they were taken with, and the `buildConfigHash` of a new build.
 * @returns The new container names, the deployment's own name first.
 */
export async function startContainers(
  dependencies: Pick<DeployRunnerDependencies, "database" | "docker"> & {
    readonly config: Pick<DeployRunnerConfig, "network">;
  },
  context: Pick<
    DeployContext,
    "deployment" | "project" | "logs" | "state" | "assertOwnership" | "signal"
  >,
  release: {
    readonly imageTag: string;
    readonly runtimeValues: Readonly<Record<string, string>>;
    readonly runtimeConfigHash: string;
    /** Null when the image was reused, which keeps the hash copied from its source. */
    readonly buildConfigHash: string | null;
  },
): Promise<string[]> {
  const { database, docker, config } = dependencies;
  const { deployment, project, logs } = context;
  const attemptId = Bun.randomUUIDv7();
  const containerNames = Array.from({ length: replicaCountOf(context) }, (_, index) =>
    replicaContainerNameFor(project.slug, attemptId, index + 1),
  );
  const [containerName = ""] = containerNames;
  assertDeployActive(context);
  transitionDeployment(database, deployment.id, {
    to: "starting",
    imageTag: release.imageTag,
    // Tasks and container logs use the first replica, which keeps the deployment's own name.
    containerName,
    internalPort: project.internalPort,
    runtimeConfigHash: release.runtimeConfigHash,
    ...(release.buildConfigHash == null ? {} : { buildConfigHash: release.buildConfigHash }),
  });
  logs.system(
    containerNames.length === 1
      ? `Starting container ${containerName}`
      : `Starting ${containerNames.length} replicas: ${containerNames.join(", ")}`,
  );
  await docker.ensureNetwork(config.network);
  assertDeployActive(context);
  // Previews never mount production's data.
  const volumes = deployment.previewId == null ? await prepareVolumes(dependencies, context) : [];
  const starts = await Promise.allSettled(
    containerNames.map(
      async (name) => await startReplica(dependencies, context, { ...release, name, volumes }),
    ),
  );
  // Cleanup must wait for every start, including those still running after another failed.
  const failed = starts.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
  return containerNames;
}

async function startReplica(
  dependencies: Pick<DeployRunnerDependencies, "docker"> & {
    readonly config: Pick<DeployRunnerConfig, "network">;
  },
  context: Pick<DeployContext, "deployment" | "project" | "state" | "assertOwnership" | "signal">,
  replica: {
    readonly name: string;
    readonly imageTag: string;
    readonly runtimeValues: Readonly<Record<string, string>>;
    readonly volumes: readonly { readonly name: string; readonly target: string }[];
  },
): Promise<void> {
  const { docker, config } = dependencies;
  const { project } = context;
  assertDeployActive(context);
  const leftover = await docker.inspectContainer(replica.name);
  assertDeployActive(context);
  if (leftover != null) {
    // Left behind by a previous attempt of this same deployment that crashed.
    await docker.removeContainer(replica.name);
  }
  assertDeployActive(context);
  context.state.useContainer(replica.name);
  await docker.runContainer(
    {
      containerName: replica.name,
      imageTag: replica.imageTag,
      network: config.network,
      labels: deploymentLabels(context),
      environmentKeys: Object.keys(replica.runtimeValues),
      volumes: [...replica.volumes],
      resources: {
        memoryLimitInMb: project.memoryLimitInMb,
        cpuLimitInMillicores: project.cpuLimitInMillicores,
      },
    },
    replica.runtimeValues,
  );
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
