import { type Deployment, transitionDeployment } from "@/deployments";
import { type DockerEngine, imageTagFor, railpackBaseTagFor } from "@/docker";
import { recordDetectedPort } from "@/projects";

import {
  assertNotCancelled,
  type DeployContext,
  type DeployRunnerDependencies,
  deploymentLabels,
  MILLISECONDS_PER_SECOND,
} from "./deploy-context";
import type { DeploymentLogWriter } from "./deployment-log-writer";
import { detectExposedPort } from "./exposed-port";
import { DeploymentWorkspace, resolveInsideWorkspace } from "./workspace";

const DISPLAYED_SHA_LENGTH = 12;

/** Secrets the build needs, already decrypted. */
export type BuildSecrets = {
  readonly buildValues: Readonly<Record<string, string>>;
  readonly repositoryToken: string | null;
};

/**
 * Clones the revision a deployment asks for into its workspace and records the commit.
 *
 * @param dependencies - Database, git and settings.
 * @param context - Deployment being run.
 * @param checkout - Workspace to clone into and the token for a private repository.
 * @throws {DeploymentCancelledError} When the deployment is cancelled during the clone.
 */
export async function cloneRevision(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  {
    workspace,
    repositoryToken,
  }: { readonly workspace: DeploymentWorkspace; readonly repositoryToken: string | null },
): Promise<void> {
  const { database, git, config } = dependencies;
  const { deployment, project, logs, signal } = context;

  context.assertOwnership();
  assertNotCancelled(signal);
  transitionDeployment(database, deployment.id, { to: "cloning" });
  // A redeploy or rollback that has to rebuild uses the exact commit of its source.
  const commitSha = deployment.requestedCommitSha ?? deployment.commitSha;
  const revision = commitSha ?? `${deployment.branch} (latest)`;
  logs.system(`Cloning ${project.repositoryFullName} at ${revision}`);
  const commit = await git.checkoutRevision({
    cloneUrl: project.repositoryUrl,
    branch: deployment.branch,
    commitSha,
    directory: workspace.repositoryPath,
    token: repositoryToken,
    timeoutInMs: config.buildTimeoutInSeconds * MILLISECONDS_PER_SECOND,
    signal,
    onLine: (line, stream) => logs.output(line, stream),
  });
  logs.system(`Checked out ${commit.sha.slice(0, DISPLAYED_SHA_LENGTH)}: ${commit.message}`);
  context.assertOwnership();
  assertNotCancelled(signal);
  transitionDeployment(database, deployment.id, {
    to: "building",
    commitSha: commit.sha,
    commitMessage: commit.message,
  });
}

const READ_DOCKERFILE_TIMEOUT_IN_MS = 10_000;

/**
 * For an automatic port, prefers the final stage's literal EXPOSE, then final image metadata.
 * A preview only uses it: the pull request must not change production's port.
 *
 * @returns The detected port, or null when the port is not automatic or no EXPOSE names one.
 */
async function detectPort(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  source: { readonly dockerfilePath: string; readonly imageTag: string },
): Promise<number | null> {
  const { project, logs, deployment } = context;
  if (project.internalPortAuto === false) {
    return null;
  }
  const [result, exposed] = await Promise.all([
    dependencies.runner(["cat", source.dockerfilePath], {
      timeoutInMs: READ_DOCKERFILE_TIMEOUT_IN_MS,
    }),
    dependencies.docker.images.exposedPorts(source.imageTag),
  ]);
  context.assertOwnership();
  assertNotCancelled(context.signal);
  const declared = result.exitCode === 0 ? detectExposedPort(result.stdout) : null;
  const port = declared != null && exposed.includes(declared) ? declared : (exposed.at(0) ?? null);
  if (port == null) {
    logs.system(
      `No exposed TCP port in the final image; using port ${project.internalPort}`,
      "warn",
    );
    return null;
  }
  if (port !== project.internalPort && deployment.previewId == null) {
    recordDetectedPort(dependencies.database, project.id, port);
  }
  logs.system(`Using exposed port ${port} of the final image`);
  return port;
}

async function buildImage(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  {
    workspace,
    buildValues,
  }: {
    readonly workspace: DeploymentWorkspace;
    readonly buildValues: Readonly<Record<string, string>>;
  },
): Promise<{ imageTag: string; detectedPort: number | null }> {
  const { docker, config, runner } = dependencies;
  const { project, logs, signal } = context;
  if (project.builder === "railpack") {
    return {
      imageTag: await buildWithRailpack(dependencies, context, { workspace, buildValues }),
      detectedPort: null,
    };
  }

  const dockerfilePath = await resolveInsideWorkspace(
    runner,
    workspace.repositoryPath,
    project.dockerfilePath,
  );
  const contextPath = await resolveInsideWorkspace(
    runner,
    workspace.repositoryPath,
    project.buildContext,
  );
  context.assertOwnership();
  assertNotCancelled(signal);
  // A build that outlives its lease must not overwrite the next attempt's image tag.
  const imageTag = imageTagFor(project.slug, Bun.randomUUIDv7());
  logs.system(`Building image ${imageTag} from ${project.dockerfilePath}`);
  await docker.buildImage(
    {
      dockerfilePath,
      contextPath,
      imageTag,
      labels: deploymentLabels(context),
      buildArgKeys: Object.keys(buildValues),
    },
    buildValues,
    {
      timeoutInMs: config.buildTimeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal,
      onLine: (line, stream) => logs.output(line, stream),
      cwd: workspace.repositoryPath,
    },
  );
  logs.system("Image built");
  const detectedPort = await detectPort(dependencies, context, { dockerfilePath, imageTag });
  return { imageTag, detectedPort };
}

function secretsHash(values: Readonly<Record<string, string>>): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    JSON.stringify(Object.entries(values).toSorted(([left], [right]) => left.localeCompare(right))),
  );
  return hasher.digest("hex");
}

async function runChecked(
  runner: DeployRunnerDependencies["runner"],
  command: readonly string[],
  run: {
    readonly what: string;
    readonly timeoutInMs: number;
    readonly signal: AbortSignal;
    readonly logs: DeploymentLogWriter;
  },
): Promise<void> {
  const result = await runner(command, {
    timeoutInMs: run.timeoutInMs,
    signal: run.signal,
    onLine: (line, stream) => run.logs.output(line, stream),
  });
  if (result.exitCode !== 0) {
    throw new Error(`${run.what} failed${result.timedOut ? " (timed out)" : ""}`);
  }
}

/**
 * Plans the build with Railpack, builds the plan on Docker's BuildKit and adds the platform
 * labels in a one-line build on top, which the Railpack frontend cannot set itself.
 *
 * @returns The labelled image tag.
 */
async function buildWithRailpack(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  {
    workspace,
    buildValues,
  }: {
    readonly workspace: DeploymentWorkspace;
    readonly buildValues: Readonly<Record<string, string>>;
  },
): Promise<string> {
  const { docker, config, runner } = dependencies;
  const { deployment, project, logs, signal } = context;
  const timeoutInMs = config.buildTimeoutInSeconds * MILLISECONDS_PER_SECOND;
  const contextPath = await resolveInsideWorkspace(
    runner,
    workspace.repositoryPath,
    project.buildContext,
  );
  const planPath = `${workspace.path}/railpack-plan.json`;
  logs.system("Detecting the stack with Railpack");
  // Railpack reads build variables while planning; logs are redacted, so values never show.
  await runChecked(
    runner,
    [
      config.railpackBinary,
      "prepare",
      contextPath,
      "--plan-out",
      planPath,
      "--info-out",
      `${workspace.path}/railpack-info.json`,
      ...Object.entries(buildValues).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ],
    { what: "railpack prepare", timeoutInMs, signal, logs },
  );
  const imageTag = imageTagFor(project.slug, deployment.id);
  const baseTag = railpackBaseTagFor(imageTag);
  logs.system(`Building image ${imageTag} with Railpack`);
  const run = {
    timeoutInMs,
    signal,
    onLine: (line: string, stream: "stdout" | "stderr") => logs.output(line, stream),
    cwd: workspace.repositoryPath,
  };
  await docker.buildWithRailpack(
    {
      planPath,
      contextPath,
      imageTag: baseTag,
      secretKeys: Object.keys(buildValues),
      secretsHash: secretsHash(buildValues),
      cacheKey: project.id,
    },
    buildValues,
    run,
  );
  const labelDirectory = `${workspace.path}/railpack-label`;
  await runChecked(
    runner,
    [
      "sh",
      "-c",
      'mkdir -p "$1" && printf "FROM %s\\n" "$2" > "$1/Dockerfile"',
      "sh",
      labelDirectory,
      baseTag,
    ],
    { what: "Writing the label Dockerfile", timeoutInMs, signal, logs },
  );
  await docker.buildImage(
    {
      dockerfilePath: `${labelDirectory}/Dockerfile`,
      contextPath: labelDirectory,
      imageTag,
      labels: deploymentLabels(context),
      buildArgKeys: [],
    },
    {},
    { ...run, cwd: labelDirectory },
  );
  // The labelled image keeps the layers; only the unlabelled tag goes.
  await docker.images
    .removeRailpackBase(baseTag)
    .catch((error: unknown) =>
      logs.system(
        `Could not remove the intermediate image ${baseTag}: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      ),
    );
  logs.system("Image built");
  return imageTag;
}

/**
 * Clones the requested revision into a fresh workspace and builds its image.
 *
 * @returns The built image tag, and the port read from the Dockerfile when the project's port
 *   is automatic.
 */
export async function buildFromSource(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  secrets: BuildSecrets,
): Promise<{ imageTag: string; detectedPort: number | null }> {
  await using workspace = await DeploymentWorkspace.create(dependencies.runner, {
    root: dependencies.config.workspaceDir,
    prefix: context.project.slug,
    onCleanupError: (message) =>
      context.logs.system(`Could not remove the build workspace: ${message}`, "warn"),
  });
  await cloneRevision(dependencies, context, {
    workspace,
    repositoryToken: secrets.repositoryToken,
  });
  return await buildImage(dependencies, context, { workspace, buildValues: secrets.buildValues });
}

/**
 * Reuses the image of the deployment being redeployed or rolled back to, without rebuilding.
 *
 * @returns The reused image tag, or null when this server does not have it (it was pruned,
 *   or the source deployment ran on another server) and the revision must be built again.
 * @throws {Error} When the source deployment has no image.
 */
export async function reuseImage(
  docker: DockerEngine,
  deployment: Deployment,
  logs: DeploymentLogWriter,
): Promise<string | null> {
  const imageTag = deployment.imageTag;
  if (imageTag == null) {
    throw new Error("The source deployment has no image to reuse");
  }
  if (await docker.images.exists(imageTag)) {
    logs.system(`Reusing image ${imageTag} without rebuilding`);
    return imageTag;
  }
  if (deployment.commitSha == null) {
    throw new Error(`Image ${imageTag} is no longer available on this server`);
  }
  logs.system(`Image ${imageTag} is not on this server; building commit ${deployment.commitSha}`);
  return null;
}
