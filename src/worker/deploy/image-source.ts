import { type Deployment, transitionDeployment } from "@/deployments";
import { type DockerEngine, imageTagFor, managedLabels } from "@/docker";

import {
  assertNotCancelled,
  type DeployContext,
  type DeployRunnerDependencies,
  MILLISECONDS_PER_SECOND,
} from "./deploy-context";
import type { DeploymentLogWriter } from "./deployment-log-writer";
import { DeploymentWorkspace, resolveInsideWorkspace } from "./workspace";

const DISPLAYED_SHA_LENGTH = 12;

/** Secrets the build needs, already decrypted. */
export type BuildSecrets = {
  readonly buildValues: Readonly<Record<string, string>>;
  readonly repositoryToken: string | null;
};

async function cloneRevision(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  {
    workspace,
    repositoryToken,
  }: { readonly workspace: DeploymentWorkspace; readonly repositoryToken: string | null },
): Promise<void> {
  const { database, git, config } = dependencies;
  const { deployment, project, logs, signal } = context;

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
  assertNotCancelled(signal);
  transitionDeployment(database, deployment.id, {
    to: "building",
    commitSha: commit.sha,
    commitMessage: commit.message,
  });
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
): Promise<string> {
  const { docker, config, runner } = dependencies;
  const { deployment, project, logs, signal } = context;

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
  return imageTag;
}

/**
 * Clones the requested revision into a fresh workspace and builds its image.
 *
 * @returns The built image tag.
 */
export async function buildFromSource(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  secrets: BuildSecrets,
): Promise<string> {
  await using workspace = await DeploymentWorkspace.create(
    dependencies.runner,
    dependencies.config.workspaceDir,
    context.project.slug,
  );
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
  if (await docker.imageExists(imageTag)) {
    logs.system(`Reusing image ${imageTag} without rebuilding`);
    return imageTag;
  }
  if (deployment.commitSha == null) {
    throw new Error(`Image ${imageTag} is no longer available on this server`);
  }
  logs.system(`Image ${imageTag} is not on this server; building commit ${deployment.commitSha}`);
  return null;
}
