import type { Database } from "@/db";
import {
  completeDeployment,
  type Deployment,
  getDeployment,
  isCancellationRequested,
  isTerminalStatus,
  runtimeConfigFingerprint,
  transitionDeployment,
} from "@/deployments";
import {
  containerNameFor,
  type DockerEngine,
  imageTagFor,
  LABELS,
  managedLabels,
  traefikLabels,
} from "@/docker";
import { listProjectDomains } from "@/domains";
import { resolveEnvironment } from "@/environments";
import type { GitClient } from "@/git";
import { getProject, type Project, readRepositoryToken } from "@/projects";
import { createRedactor, type SecretBox } from "@/secrets";
import { getSystemSettings } from "@/settings";

import { DeploymentLogWriter } from "./deployment-log-writer";
import { networkProbes, type Probes, waitUntilHealthy } from "./health-check";
import { DeploymentWorkspace, resolveInsideWorkspace } from "./workspace";

const CANCEL_POLL_INTERVAL_IN_MS = 1000;
const MILLISECONDS_PER_SECOND = 1000;
const FAILED_CONTAINER_LOG_LINES = 50;

/** Settings the deploy runner reads from configuration. */
export type DeployRunnerConfig = {
  readonly workspaceDir: string;
  readonly network: string;
  readonly buildTimeoutInSeconds: number;
  readonly healthCheckTimeoutInSeconds: number;
  readonly imagesKeptPerProject: number;
  readonly traefik: {
    readonly enabled: boolean;
    readonly httpEntrypoint: string;
    readonly httpsEntrypoint: string;
    readonly certResolver: string;
  };
};

/** Everything the deploy runner talks to. Tests replace Docker, git and probes. */
export type DeployRunnerDependencies = {
  readonly database: Database;
  readonly docker: DockerEngine;
  readonly git: Pick<GitClient, "cloneAndCheckout">;
  readonly secretBox: SecretBox;
  readonly config: DeployRunnerConfig;
  readonly probes?: Probes;
};

/** Thrown when a running deployment is cancelled at a checkpoint. */
class DeploymentCancelledError extends Error {
  constructor() {
    super("Deployment cancelled by a user");
    this.name = "DeploymentCancelledError";
  }
}

function watchCancellation(
  database: Database,
  deploymentId: string,
  controller: AbortController,
): Disposable {
  const timer = setInterval(() => {
    if (isCancellationRequested(database, deploymentId)) {
      controller.abort();
    }
  }, CANCEL_POLL_INTERVAL_IN_MS);
  return { [Symbol.dispose]: () => clearInterval(timer) };
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one deployment end to end: clone, build, start, health check, switch traffic.
 *
 * @remarks
 * The previous container keeps serving until the new one passes its health check; only
 * then are older containers of the project removed. When anything fails, the new container
 * is removed and the previous one is left untouched. Both containers are attached to the
 * proxy for a moment during the switch, so requests may briefly reach either version.
 *
 * @param dependencies - Database, Docker, git, encryption and settings.
 * @param deploymentId - Deployment to run.
 * @param jobSignal - Aborted when the worker shuts down.
 * @returns The final deployment status.
 */
export async function runDeployment(
  dependencies: DeployRunnerDependencies,
  deploymentId: string,
  jobSignal: AbortSignal,
): Promise<"succeeded" | "failed" | "cancelled" | "skipped"> {
  const { database } = dependencies;
  const deployment = getDeployment(database, deploymentId);
  if (isTerminalStatus(deployment.status)) {
    return "skipped";
  }
  if (deployment.status !== "queued") {
    // A retried job after a worker crash: start the deployment over from the queue state.
    transitionDeployment(database, deploymentId, "queued");
  }
  const project = getProject(database, deployment.projectId);
  const cancellation = new AbortController();
  const signal = AbortSignal.any([cancellation.signal, jobSignal]);
  using logs = new DeploymentLogWriter(database, deploymentId);
  using _cancellationWatch = watchCancellation(database, deploymentId, cancellation);
  const state = new DeployState();

  try {
    await deploy(dependencies, { deployment, project, logs, signal, state });
    // Readers end the live stream on a terminal status, so pending lines go out first.
    logs.flush();
    completeDeployment(database, deploymentId);
    logs.system("Deployment succeeded");
    await removePreviousContainers(dependencies, project.id, deploymentId, logs);
    await pruneOldImages(dependencies, project.id, logs);
    return "succeeded";
  } catch (error) {
    const cancelled = cancellation.signal.aborted || error instanceof DeploymentCancelledError;
    await discardFailedContainer(dependencies.docker, state.containerName, logs);
    const message = cancelled
      ? "Deployment cancelled by a user"
      : state.redact(errorMessageOf(error));
    logs.system(message, "error");
    logs.flush();
    transitionDeployment(database, deploymentId, cancelled ? "cancelled" : "failed", {
      errorMessage: message,
    });
    if (jobSignal.aborted && cancelled === false) {
      throw error;
    }
    return cancelled ? "cancelled" : "failed";
  }
}

/** Facts learned while deploying that the failure path needs. */
class DeployState {
  containerName: string | null = null;
  redact: (text: string) => string = (text) => text;

  useContainer(name: string): void {
    this.containerName = name;
  }

  useRedactor(redact: (text: string) => string): void {
    this.redact = redact;
  }
}

type DeployContext = {
  readonly deployment: Deployment;
  readonly project: Project;
  readonly logs: DeploymentLogWriter;
  readonly signal: AbortSignal;
  readonly state: DeployState;
};

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DeploymentCancelledError();
  }
}

async function deploy(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
): Promise<void> {
  const { database, docker, config, secretBox } = dependencies;
  const { deployment, project, logs, signal } = context;

  const environment = await resolveEnvironment(database, secretBox, project.id);
  // Taken with the variables it describes, so later edits show up as pending changes.
  const runtimeConfigHash = runtimeConfigFingerprint(database, project.id);
  const repositoryToken = await readRepositoryToken(database, secretBox, project.id);
  context.state.useRedactor(createRedactor([...environment.secretValues, repositoryToken ?? ""]));
  logs.useRedactor(context.state.redact);

  const imageTag =
    deployment.sourceDeploymentId == null
      ? await buildFromSource(dependencies, context, {
          buildValues: environment.build,
          repositoryToken,
        })
      : await reuseImage(docker, deployment, logs);
  assertNotCancelled(signal);

  const containerName = containerNameFor(project.slug, deployment.id);
  transitionDeployment(database, deployment.id, "starting", {
    imageTag,
    containerName,
    runtimeConfigHash,
  });
  logs.system(`Starting container ${containerName}`);
  await docker.ensureNetwork(config.network);
  const leftover = await docker.inspectContainer(containerName);
  if (leftover != null) {
    // Left behind by a previous attempt of this same deployment that crashed.
    await docker.removeContainer(containerName);
  }
  const domains = listProjectDomains(database, project.id, getSystemSettings(database));
  const labels = {
    ...managedLabels({
      projectId: project.id,
      projectSlug: project.slug,
      deploymentId: deployment.id,
    }),
    ...(config.traefik.enabled
      ? traefikLabels({
          projectSlug: project.slug,
          domains,
          internalPort: project.internalPort,
          network: config.network,
          httpEntrypoint: config.traefik.httpEntrypoint,
          httpsEntrypoint: config.traefik.httpsEntrypoint,
          certResolver: config.traefik.certResolver,
        })
      : {}),
  };
  context.state.useContainer(containerName);
  await docker.runContainer(
    {
      containerName,
      imageTag,
      network: config.network,
      labels,
      environmentKeys: Object.keys(environment.runtime),
    },
    environment.runtime,
  );
  if (domains.length > 0) {
    const hostnames = domains.map((domain) => domain.hostname).join(", ");
    logs.system(
      config.traefik.enabled
        ? `Routing ${hostnames}`
        : `Proxy disabled; domains not routed: ${hostnames}`,
      config.traefik.enabled ? "info" : "warn",
    );
  }

  transitionDeployment(database, deployment.id, "health_checking");
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

async function buildFromSource(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  secrets: {
    readonly buildValues: Readonly<Record<string, string>>;
    readonly repositoryToken: string | null;
  },
): Promise<string> {
  const { database, docker, git, config } = dependencies;
  const { deployment, project, logs, signal } = context;
  const timeoutInMs = config.buildTimeoutInSeconds * MILLISECONDS_PER_SECOND;

  transitionDeployment(database, deployment.id, "cloning");
  await using workspace = await DeploymentWorkspace.create(config.workspaceDir, project.slug);
  const revision = deployment.requestedCommitSha ?? `${deployment.branch} (latest)`;
  logs.system(`Cloning ${project.repositoryFullName} at ${revision}`);
  const commit = await git.cloneAndCheckout({
    cloneUrl: project.repositoryUrl,
    branch: deployment.branch,
    commitSha: deployment.requestedCommitSha,
    directory: workspace.repositoryPath,
    scratchDirectory: workspace.path,
    token: secrets.repositoryToken,
    timeoutInMs,
    signal,
    onLine: (line, stream) => logs.output(line, stream),
  });
  logs.system(`Checked out ${commit.sha.slice(0, 12)}: ${commit.message}`);
  assertNotCancelled(signal);

  transitionDeployment(database, deployment.id, "building", {
    commitSha: commit.sha,
    commitMessage: commit.message,
  });
  const dockerfilePath = await resolveInsideWorkspace(
    workspace.repositoryPath,
    project.dockerfilePath,
  );
  const contextPath = await resolveInsideWorkspace(workspace.repositoryPath, project.buildContext);
  const imageTag = imageTagFor(project.slug, deployment.id);
  logs.system(`Building image ${imageTag} from ${project.dockerfilePath}`);
  await docker.buildImage(
    {
      dockerfilePath,
      contextPath,
      imageTag,
      labels: managedLabels({
        projectId: project.id,
        projectSlug: project.slug,
        deploymentId: deployment.id,
      }),
      buildArgKeys: Object.keys(secrets.buildValues),
    },
    secrets.buildValues,
    {
      timeoutInMs,
      signal,
      onLine: (line, stream) => logs.output(line, stream),
      cwd: workspace.repositoryPath,
    },
  );
  logs.system("Image built");
  return imageTag;
}

async function reuseImage(
  docker: DockerEngine,
  deployment: Deployment,
  logs: DeploymentLogWriter,
): Promise<string> {
  const imageTag = deployment.imageTag;
  if (imageTag == null) {
    throw new Error("The source deployment has no image to reuse");
  }
  logs.system(`Reusing image ${imageTag} without rebuilding`);
  if ((await docker.imageExists(imageTag)) === false) {
    throw new Error(`Image ${imageTag} is no longer available on this server`);
  }
  return imageTag;
}

async function discardFailedContainer(
  docker: DockerEngine,
  containerName: string | null,
  logs: DeploymentLogWriter,
): Promise<void> {
  if (containerName == null) {
    return;
  }
  try {
    const lines = await docker.readContainerLogs(containerName, FAILED_CONTAINER_LOG_LINES);
    if (lines.length > 0) {
      logs.system(`Last ${lines.length} lines from the failed container:`, "warn");
    }
    for (const { line, stream } of lines) {
      logs.output(line, stream);
    }
    await docker.removeContainer(containerName);
    logs.system(
      `Removed failed container ${containerName}; the previous version keeps running`,
      "warn",
    );
  } catch (error) {
    logs.system(`Could not clean up container ${containerName}: ${errorMessageOf(error)}`, "warn");
  }
}

async function removePreviousContainers(
  dependencies: DeployRunnerDependencies,
  projectId: string,
  currentDeploymentId: string,
  logs: DeploymentLogWriter,
): Promise<void> {
  const containers = await dependencies.docker.listManagedContainers();
  const previous = containers.filter(
    (container) =>
      container.labels[LABELS.projectId] === projectId &&
      container.labels[LABELS.deploymentId] !== currentDeploymentId,
  );
  for (const container of previous) {
    try {
      // Sequential on purpose: stopping containers in parallel spikes host load.
      await dependencies.docker.removeContainer(container.id);
      logs.system(`Removed previous container ${container.name}`);
    } catch (error) {
      logs.system(
        `Could not remove previous container ${container.name}: ${errorMessageOf(error)}`,
        "warn",
      );
    }
  }
}

async function pruneOldImages(
  dependencies: DeployRunnerDependencies,
  projectId: string,
  logs: DeploymentLogWriter,
): Promise<void> {
  try {
    const images = await dependencies.docker.listProjectImages(projectId);
    const stale = images.slice(dependencies.config.imagesKeptPerProject);
    const results = await Promise.allSettled(
      stale.map(async (image) => await dependencies.docker.removeImage(image)),
    );
    const removed = results.filter((result) => result.status === "fulfilled").length;
    if (removed > 0) {
      logs.system(
        `Removed ${removed} old image(s); kept the ${dependencies.config.imagesKeptPerProject} newest for rollback`,
      );
    }
  } catch (error) {
    logs.system(`Could not prune old images: ${errorMessageOf(error)}`, "warn");
  }
}
