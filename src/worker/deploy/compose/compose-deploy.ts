import { posix } from "node:path";

import { transitionDeployment } from "@/deployments";
import { composeContainerNameFor, composeProjectNameFor, LABELS, managedLabels } from "@/docker";
import { type CommandRunner, DEFAULT_MAX_CAPTURED_BYTES, failureReason } from "@/process";

import {
  assertNotCancelled,
  type DeployContext,
  type DeployRunnerDependencies,
  MILLISECONDS_PER_SECOND,
} from "../deploy-context";
import { cloneRevision } from "../image-source";
import { DeploymentWorkspace, resolveInsideWorkspace } from "../workspace";
import { checkComposeConfig, checkComposeSource } from "./compose-config";
import { composeFileFor } from "./compose-file";
import { ComposeWorkspaceError } from "./compose.errors";

const FILE_COMMAND_TIMEOUT_IN_MS = 30_000;
const HOST_PATH_CHECK_BATCH_SIZE = 8;
/** Largest Compose file the platform writes. */
const MAX_COMPOSE_FILE_BYTES = 100_000;
const MAX_COMPOSE_SOURCE_BYTES = DEFAULT_MAX_CAPTURED_BYTES;
const MAX_COMPOSE_CAPTURE_BYTES = MAX_COMPOSE_SOURCE_BYTES * 2;
const COMPOSE_FILE_TOO_LARGE_EXIT_CODE = 45;
const COMPOSE_READ_FOOTER = /^\.[ \t]*(\d+)\n$/;
// Wrap the encoded data within the runner's per-line limit. Only print the footer on success.
const READ_COMPOSE_SCRIPT = [
  '[ -f "$1" ] || exit 1',
  'size=$(wc -c < "$1") || exit "$?"',
  `[ "$size" -le ${MAX_COMPOSE_SOURCE_BYTES} ] || exit ${COMPOSE_FILE_TOO_LARGE_EXIT_CODE}`,
  'base64 -w 76 "$1" && printf ".%s\\n" "$size"',
].join("\n");
const GENERATED_FILE = "nelcota-compose.json";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

/** Values and fingerprints a Compose deployment starts with. */
export type ComposeRelease = {
  readonly runtimeValues: Readonly<Record<string, string>>;
  /** Variables also available to the build, which the file may interpolate. */
  readonly buildValues: Readonly<Record<string, string>>;
  readonly repositoryToken: string | null;
  readonly runtimeConfigHash: string;
  readonly buildConfigHash: string;
};

/**
 * Clones the revision, checks its Compose file, then builds and starts the project's services
 * with Docker Compose. Services whose configuration changed are recreated in place.
 *
 * @param dependencies - Database, Docker, git and settings of the project's server.
 * @param context - Deployment being run.
 * @param release - Variables, repository token and configuration fingerprints.
 * @returns The containers of the service that receives the domains, to check and route.
 * @throws {InvalidComposeFileError} When the file asks for something a project may not run.
 * @throws {PathOutsideWorkspaceError} When the file reads a file outside the repository.
 * @throws {DockerCommandError} When Compose rejects the file or a service fails to start.
 */
export async function deployCompose(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  release: ComposeRelease,
): Promise<string[]> {
  const { runner } = dependencies;
  const { project, logs } = context;
  const routedService = project.composeService;
  if (routedService == null) {
    throw new Error(`Project ${project.id} has no Compose service to receive its domains`);
  }
  await using workspace = await DeploymentWorkspace.create(runner, {
    root: dependencies.config.workspaceDir,
    prefix: project.slug,
    onCleanupError: (message) => logs.system(`Could not remove the workspace: ${message}`, "warn"),
  });
  await cloneRevision(dependencies, context, {
    workspace,
    repositoryToken: release.repositoryToken,
  });
  const file = await checkedComposeFile(dependencies, context, {
    workspace,
    routedService,
    release,
  });
  assertNotCancelled(context.signal);
  return await startCompose(dependencies, context, { workspace, routedService, release, file });
}

async function checkedComposeFile(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  input: {
    readonly workspace: DeploymentWorkspace;
    readonly routedService: string;
    readonly release: ComposeRelease;
  },
): Promise<Record<string, unknown>> {
  const { runner, docker, config } = dependencies;
  const { deployment, project, logs } = context;
  const repositoryPath = input.workspace.repositoryPath;
  context.assertOwnership();
  assertNotCancelled(context.signal);
  const composePath = await resolveInsideWorkspace(runner, repositoryPath, project.composeFilePath);
  logs.system(`Checking ${project.composeFilePath}`);
  checkComposeSource(await readFile(runner, composePath));
  const projectName = composeProjectNameFor(project.id);
  context.assertOwnership();
  assertNotCancelled(context.signal);
  const rendered = await docker.compose.renderConfig(
    { projectName, files: [composePath], directory: repositoryPath },
    { ...input.release.buildValues, ...input.release.runtimeValues },
  );
  const checked = checkComposeConfig(rendered, {
    routedService: input.routedService,
    repositoryPath,
  });
  // The text check above cannot see symlinks; each file must really be in the repository.
  await verifyHostPaths(runner, context, { repositoryPath, paths: checked.hostPaths });
  const projectLabels = {
    [LABELS.managed]: "true",
    [LABELS.projectId]: project.id,
    [LABELS.projectSlug]: project.slug,
    [LABELS.composeProject]: projectName,
  };
  return composeFileFor(checked.model, {
    projectName,
    routedService: input.routedService,
    network: config.network,
    projectLabels,
    routedLabels: managedLabels({
      projectId: project.id,
      projectSlug: project.slug,
      deploymentId: deployment.id,
      previewId: null,
    }),
    environmentKeys: Object.keys(input.release.runtimeValues),
    memoryLimitInMb: project.memoryLimitInMb,
    cpuLimitInMillicores: project.cpuLimitInMillicores,
  });
}

async function verifyHostPaths(
  runner: CommandRunner,
  context: DeployContext,
  { repositoryPath, paths }: { readonly repositoryPath: string; readonly paths: readonly string[] },
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += HOST_PATH_CHECK_BATCH_SIZE) {
    context.assertOwnership();
    assertNotCancelled(context.signal);
    const batch = paths.slice(offset, offset + HOST_PATH_CHECK_BATCH_SIZE);
    // Wait for the whole batch before a failure can release and remove the checkout.
    const checks = await Promise.allSettled(
      batch.map(
        async (path) =>
          await resolveInsideWorkspace(
            runner,
            repositoryPath,
            relativeInside(repositoryPath, path),
          ),
      ),
    );
    const failure = checks.find((check) => check.status === "rejected");
    if (failure != null) {
      throw failure.reason;
    }
  }
}

async function startCompose(
  dependencies: DeployRunnerDependencies,
  context: DeployContext,
  input: {
    readonly workspace: DeploymentWorkspace;
    readonly routedService: string;
    readonly release: ComposeRelease;
    readonly file: Record<string, unknown>;
  },
): Promise<string[]> {
  const { runner, docker, database, config } = dependencies;
  const { deployment, project, logs, signal } = context;
  const projectName = composeProjectNameFor(project.id);
  const filePath = posix.join(input.workspace.path, GENERATED_FILE);
  await writePrivateFile(runner, filePath, JSON.stringify(input.file));
  context.assertOwnership();
  assertNotCancelled(signal);
  transitionDeployment(database, deployment.id, {
    to: "starting",
    // Compose names its own images; rollbacks rebuild the commit instead of reusing one.
    imageTag: `compose:${projectName}`,
    containerName: composeContainerNameFor(projectName, input.routedService),
    internalPort: project.internalPort,
    runtimeConfigHash: input.release.runtimeConfigHash,
    buildConfigHash: input.release.buildConfigHash,
  });
  logs.system(`Starting the Compose services of ${project.composeFilePath}`);
  await docker.ensureNetwork(config.network);
  context.assertOwnership();
  assertNotCancelled(signal);
  await docker.compose.up(
    { projectName, files: [filePath], directory: input.workspace.repositoryPath },
    {
      env: { ...input.release.buildValues, ...input.release.runtimeValues },
      timeoutInMs: config.buildTimeoutInSeconds * MILLISECONDS_PER_SECOND,
      signal,
      onLine: (line, stream) => logs.output(line, stream),
    },
  );
  context.assertOwnership();
  assertNotCancelled(signal);
  const routed = (await docker.listManagedContainers()).filter(
    (container) =>
      container.labels[LABELS.composeProject] === projectName &&
      container.labels[COMPOSE_SERVICE_LABEL] === input.routedService,
  );
  if (routed.length === 0) {
    throw new Error(`The Compose service ${input.routedService} started no container`);
  }
  return routed.map((container) => container.name).toSorted();
}

async function readFile(runner: DeployRunnerDependencies["runner"], path: string): Promise<string> {
  const result = await runner(["sh", "-c", READ_COMPOSE_SCRIPT, "sh", path], {
    timeoutInMs: FILE_COMMAND_TIMEOUT_IN_MS,
    maxCapturedBytes: MAX_COMPOSE_CAPTURE_BYTES,
  });
  if (result.timedOut || result.aborted) {
    throw new ComposeWorkspaceError(`reading ${path} ${failureReason(result)}`);
  }

  if (result.exitCode === COMPOSE_FILE_TOO_LARGE_EXIT_CODE) {
    throw new ComposeWorkspaceError(
      `the Compose source is larger than ${MAX_COMPOSE_SOURCE_BYTES} bytes`,
    );
  }

  if (result.exitCode !== 0) {
    throw new ComposeWorkspaceError(`reading ${path} failed: ${failureReason(result)}`);
  }

  const footerOffset = result.stdout.lastIndexOf("\n", result.stdout.length - 2) + 1;
  const footer = COMPOSE_READ_FOOTER.exec(result.stdout.slice(footerOffset));
  const size = Number(footer?.[1]);
  if (Number.isSafeInteger(size) === false || size < 0 || size > MAX_COMPOSE_SOURCE_BYTES) {
    throw new ComposeWorkspaceError("the Compose source read did not complete");
  }

  const bytes = Buffer.from(result.stdout.slice(0, footerOffset), "base64");
  if (bytes.byteLength !== size) {
    throw new ComposeWorkspaceError("the Compose source changed during its read");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ComposeWorkspaceError("the Compose source is not valid UTF-8");
    }

    throw error;
  }
}

/**
 * Writes the generated file readable only by its owner. The text goes through the
 * environment, since commands get no standard input, and the path as an argument.
 */
async function writePrivateFile(
  runner: DeployRunnerDependencies["runner"],
  path: string,
  text: string,
): Promise<void> {
  if (Buffer.byteLength(text) > MAX_COMPOSE_FILE_BYTES) {
    throw new Error(`The Compose file is larger than ${MAX_COMPOSE_FILE_BYTES} bytes`);
  }
  const result = await runner(
    ["sh", "-c", 'umask 077 && printf "%s" "$NELCOTA_FILE" > "$1"', "sh", path],
    { env: { NELCOTA_FILE: text }, timeoutInMs: FILE_COMMAND_TIMEOUT_IN_MS },
  );
  if (result.exitCode !== 0) {
    throw new ComposeWorkspaceError(`writing ${path} failed: ${failureReason(result)}`);
  }
}

/** The path from the repository, or "." for the repository itself. */
function relativeInside(repositoryPath: string, path: string): string {
  const relative = posix.relative(repositoryPath, path);
  return relative === "" ? "." : relative;
}
