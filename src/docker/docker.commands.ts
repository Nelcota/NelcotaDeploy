import { InvalidDockerArgumentError } from "./docker.errors";

/** Labels that mark resources owned by the platform. Nothing without them is ever touched. */
export const LABELS = {
  managed: "io.nelcota.managed",
  projectId: "io.nelcota.project-id",
  projectSlug: "io.nelcota.project-slug",
  deploymentId: "io.nelcota.deployment-id",
  /** Pull request preview of a container or image; absent on production ones. */
  previewId: "io.nelcota.preview-id",
  /**
   * Project a database container belongs to. Database containers never carry `projectId`,
   * which marks the containers of the project's deployments.
   */
  databaseProjectId: "io.nelcota.database-project-id",
  /** The reverse proxy the platform runs on a remote server. Never an application. */
  proxy: "io.nelcota.proxy",
  /** Version of the proxy's settings; a proxy with another version is replaced. */
  proxyVersion: "io.nelcota.proxy-version",
} as const;

/**
 * Version of the proxy settings below. Raise it whenever they change, so servers set up
 * earlier get a new proxy. Version 2 reads application routes from files.
 */
export const PROXY_VERSION = "2";
/** Where the proxy reads application routes, inside its container. */
const PROXY_ROUTES_MOUNT = "/routes";

/** Name of the reverse proxy container on servers the platform set up. */
export const PROXY_CONTAINER_NAME = "nelcota-proxy";
/** Same Traefik release the panel's own Docker Compose stack uses. */
const PROXY_IMAGE = "traefik:v3.7.16";
const PROXY_CERTIFICATE_VOLUME = "nelcota-letsencrypt";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const IMAGE_REFERENCE_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL_KEY_PATTERN = /^[a-z0-9][a-z0-9._/-]*[a-z0-9]$/i;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IMAGE_REPOSITORY = "nelcota";
const SHORT_ID_LENGTH = 12;

function assertMatches(value: string, pattern: RegExp, what: string): void {
  if (pattern.test(value) === false) {
    throw new InvalidDockerArgumentError(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
}

function assertLabelValue(value: string): void {
  if (value.includes("\n") || value.includes("\0")) {
    throw new InvalidDockerArgumentError("Label values cannot contain line breaks");
  }
}

function shortId(deploymentId: string): string {
  const compact = deploymentId.replaceAll("-", "").toLowerCase();
  assertMatches(compact, /^[a-f0-9]{12,}$/, "deployment id");
  return compact.slice(-SHORT_ID_LENGTH);
}

/**
 * Returns the deterministic image tag for a deployment, such as "nelcota/api:0a1b2c3d4e5f".
 *
 * @param projectSlug - Validated project slug.
 * @param deploymentId - Deployment UUID.
 * @returns Image reference.
 * @throws {InvalidDockerArgumentError} When the slug or id is malformed.
 */
export function imageTagFor(projectSlug: string, deploymentId: string): string {
  assertMatches(projectSlug, SLUG_PATTERN, "project slug");
  return `${IMAGE_REPOSITORY}/${projectSlug}:${shortId(deploymentId)}`;
}

/**
 * Returns the deterministic container name for a deployment, such as "nelcota-api-0a1b2c3d4e5f".
 *
 * @param projectSlug - Validated project slug.
 * @param deploymentId - Deployment UUID.
 * @returns Container name.
 * @throws {InvalidDockerArgumentError} When the slug or id is malformed.
 */
export function containerNameFor(projectSlug: string, deploymentId: string): string {
  assertMatches(projectSlug, SLUG_PATTERN, "project slug");
  return `nelcota-${projectSlug}-${shortId(deploymentId)}`;
}

/**
 * Returns the deterministic Docker volume name of a project volume, such as
 * "nelcota-data-0a1b2c3d4e5f". It never changes, so data survives renames of the project.
 *
 * @param volumeId - Volume UUID.
 * @returns Volume name.
 * @throws {InvalidDockerArgumentError} When the id is malformed.
 */
export function volumeNameFor(volumeId: string): string {
  return `nelcota-data-${shortId(volumeId)}`;
}

/**
 * Returns the deterministic container name of a project database, such as
 * "nelcota-db-0a1b2c3d4e5f". It is also the host name applications connect to.
 *
 * @param databaseId - Database UUID.
 * @returns Container name.
 * @throws {InvalidDockerArgumentError} When the id is malformed.
 */
export function databaseContainerNameFor(databaseId: string): string {
  return `nelcota-db-${shortId(databaseId)}`;
}

/**
 * Returns the deterministic Docker volume name that keeps a project database's data, such as
 * "nelcota-dbdata-0a1b2c3d4e5f".
 *
 * @param databaseId - Database UUID.
 * @returns Volume name.
 * @throws {InvalidDockerArgumentError} When the id is malformed.
 */
export function databaseVolumeNameFor(databaseId: string): string {
  return `nelcota-dbdata-${shortId(databaseId)}`;
}

/**
 * Builds the platform labels for a deployment's image and container.
 *
 * @param input - Owning project, deployment and its pull request preview, if any.
 * @returns Label map.
 */
export function managedLabels(input: {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly deploymentId: string;
  readonly previewId: string | null;
}): Record<string, string> {
  return {
    [LABELS.managed]: "true",
    [LABELS.projectId]: input.projectId,
    [LABELS.projectSlug]: input.projectSlug,
    [LABELS.deploymentId]: input.deploymentId,
    ...(input.previewId == null ? {} : { [LABELS.previewId]: input.previewId }),
  };
}

export function labelArgs(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => {
    assertMatches(key, LABEL_KEY_PATTERN, "label key");
    assertLabelValue(value);
    return ["--label", `${key}=${value}`];
  });
}

/** Options for {@link buildImageArgs}. */
export type BuildImageOptions = {
  readonly dockerfilePath: string;
  readonly contextPath: string;
  readonly imageTag: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Names passed as `--build-arg NAME`; docker reads each value from its own environment. */
  readonly buildArgKeys: readonly string[];
};

/**
 * Builds `docker build` arguments. Build argument values never appear in the argument list.
 *
 * @param options - Paths must already be resolved inside the workspace.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When a tag, label or key is malformed.
 */
export function buildImageArgs(options: BuildImageOptions): string[] {
  assertMatches(options.imageTag, IMAGE_REFERENCE_PATTERN, "image tag");
  for (const key of options.buildArgKeys) {
    assertMatches(key, ENVIRONMENT_KEY_PATTERN, "build argument name");
  }
  return [
    "build",
    "--progress=plain",
    "--file",
    options.dockerfilePath,
    "--tag",
    options.imageTag,
    ...labelArgs(options.labels),
    ...options.buildArgKeys.flatMap((key) => ["--build-arg", key]),
    "--",
    options.contextPath,
  ];
}

/**
 * Railpack release the platform builds with. The frontend image must match the version of the
 * railpack CLI that wrote the plan; the install script and the worker image pin the same one.
 */
export const RAILPACK_VERSION = "0.43.0";
const RAILPACK_FRONTEND_IMAGE = `ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}`;
const SECRETS_HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Ends the tag of the image Railpack produces, which waits for the platform labels. */
const RAILPACK_BASE_SUFFIX = "-railpack";

/**
 * Returns the tag of the unlabelled image Railpack builds for a deployment's image.
 *
 * @param imageTag - Final image reference, from `imageTagFor`.
 * @returns The reference with the Railpack suffix.
 * @throws {InvalidDockerArgumentError} When the reference is malformed.
 */
export function railpackBaseTagFor(imageTag: string): string {
  assertMatches(imageTag, IMAGE_REFERENCE_PATTERN, "image tag");
  return `${imageTag}${RAILPACK_BASE_SUFFIX}`;
}

/**
 * Tells whether a reference is an unlabelled Railpack image of the platform, the only kind
 * removed without the platform label.
 *
 * @param imageTag - Image reference.
 * @returns True for "nelcota/<slug>:<id>-railpack".
 */
export function isRailpackBaseTag(imageTag: string): boolean {
  return (
    IMAGE_REFERENCE_PATTERN.test(imageTag) &&
    imageTag.startsWith(`${IMAGE_REPOSITORY}/`) &&
    imageTag.endsWith(RAILPACK_BASE_SUFFIX)
  );
}

/** Options for {@link railpackBuildArgs}. */
export type RailpackBuildOptions = {
  /** Plan written by `railpack prepare`. */
  readonly planPath: string;
  readonly contextPath: string;
  /** Tag of the image Railpack produces, before the platform labels are added. */
  readonly imageTag: string;
  /** Build secrets passed by name; docker reads each value from its own environment. */
  readonly secretKeys: readonly string[];
  /** SHA-256 hex of the secret values, so a changed value rebuilds the layers that use it. */
  readonly secretsHash: string;
  /**
   * Prefix of the build's cache mounts, such as the package manager caches. One per project,
   * so a project never reads or fills another project's caches on a shared server.
   */
  readonly cacheKey: string;
};

const CACHE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Builds `docker buildx build` arguments that build a Railpack plan with the Railpack
 * frontend, on Docker's own BuildKit. Secret values never appear in the argument list.
 *
 * @param options - Plan, context, tag, secret names, their hash and the cache key.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When the tag, a secret name, the hash or the cache key
 *   is malformed.
 */
export function railpackBuildArgs(options: RailpackBuildOptions): string[] {
  assertMatches(options.imageTag, IMAGE_REFERENCE_PATTERN, "image tag");
  assertMatches(options.secretsHash, SECRETS_HASH_PATTERN, "secrets hash");
  assertMatches(options.cacheKey, CACHE_KEY_PATTERN, "cache key");
  for (const key of options.secretKeys) {
    assertMatches(key, ENVIRONMENT_KEY_PATTERN, "build secret name");
  }
  return [
    "buildx",
    "build",
    "--progress=plain",
    "--load",
    "--build-arg",
    `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND_IMAGE}`,
    "--build-arg",
    `secrets-hash=${options.secretsHash}`,
    "--build-arg",
    `cache-key=${options.cacheKey}`,
    "--file",
    options.planPath,
    "--tag",
    options.imageTag,
    ...options.secretKeys.flatMap((key) => ["--secret", `id=${key},env=${key}`]),
    "--",
    options.contextPath,
  ];
}

/**
 * Builds `docker buildx prune` arguments that remove build cache unused for longer than the
 * retention. Build cache carries no labels, so it is the whole builder's cache.
 *
 * @param retentionInHours - Cache used within this many hours stays; a positive integer.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When the retention is not a positive integer.
 */
export function staleBuildCachePruneArgs(retentionInHours: number): string[] {
  assertPositiveInteger(retentionInHours, "build cache retention");
  return ["buildx", "prune", "--force", "--filter", `until=${retentionInHours}h`];
}

/**
 * Builds `docker buildx prune` arguments that shrink the build cache below a size, removing
 * the least recently used records first.
 *
 * @param maxUsedSpaceInGb - Most cache kept, in GB; a positive integer.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When the size is not a positive integer.
 */
export function oversizedBuildCachePruneArgs(maxUsedSpaceInGb: number): string[] {
  assertPositiveInteger(maxUsedSpaceInGb, "build cache size");
  return ["buildx", "prune", "--force", "--max-used-space", `${maxUsedSpaceInGb}gb`];
}

/**
 * Builds `docker image prune` arguments that remove dangling images of the platform only.
 *
 * @returns Arguments after the docker binary.
 */
export function danglingImagePruneArgs(): string[] {
  return ["image", "prune", "--force", "--filter", `label=${LABELS.managed}=true`];
}

/** Options for {@link runContainerArgs}. */
export type RunContainerOptions = {
  readonly containerName: string;
  readonly imageTag: string;
  readonly network: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Names passed as `--env NAME`; docker reads each value from its own environment. */
  readonly environmentKeys: readonly string[];
  /** Named volumes mounted at absolute paths inside the container. */
  readonly volumes: readonly { readonly name: string; readonly target: string }[];
  /** Arguments after the image, replacing its default command; the image's own when absent. */
  readonly command?: readonly string[];
  /** Memory and CPU limits; a null or absent limit leaves the container unlimited. */
  readonly resources?: ContainerResources;
};

/** Limits of a container. */
export type ContainerResources = {
  /** Memory in MiB, a positive integer; null for no limit. */
  readonly memoryLimitInMb: number | null;
  /** CPU in thousandths of a core, a positive integer; null for no limit. */
  readonly cpuLimitInMillicores: number | null;
};

const MILLICORES_PER_CORE = 1000;
const MILLICORE_DIGITS = 3;

function assertPositiveInteger(value: number, what: string): void {
  if (Number.isInteger(value) === false || value <= 0) {
    throw new InvalidDockerArgumentError(`Invalid ${what}: ${value}`);
  }
}

/**
 * Builds the `--memory` and `--cpus` arguments of a container.
 *
 * @param resources - The limits, if any.
 * @returns The arguments; empty without limits.
 * @throws {InvalidDockerArgumentError} When a limit is not a positive integer.
 */
export function resourceArgs(resources: ContainerResources | undefined): string[] {
  const args: string[] = [];
  if (resources?.memoryLimitInMb != null) {
    assertPositiveInteger(resources.memoryLimitInMb, "memory limit");
    args.push("--memory", `${resources.memoryLimitInMb}m`);
  }
  if (resources?.cpuLimitInMillicores != null) {
    const millicores = resources.cpuLimitInMillicores;
    assertPositiveInteger(millicores, "CPU limit");
    // Written from integers, so a limit such as 0.25 cores never goes through float rounding.
    const cores = Math.floor(millicores / MILLICORES_PER_CORE);
    const fraction = String(millicores % MILLICORES_PER_CORE).padStart(MILLICORE_DIGITS, "0");
    args.push("--cpus", `${cores}.${fraction}`);
  }
  return args;
}

// Plain absolute path: no comma or "=", which would add options to the --mount value.
const MOUNT_TARGET_PATTERN = /^(?:\/[A-Za-z0-9._-]+)+$/;

function mountArgs(volumes: RunContainerOptions["volumes"]): string[] {
  return volumes.flatMap((volume) => {
    assertMatches(volume.name, NAME_PATTERN, "volume name");
    assertMatches(volume.target, MOUNT_TARGET_PATTERN, "mount path");
    return ["--mount", `type=volume,source=${volume.name},target=${volume.target}`];
  });
}

/**
 * Builds `docker run` arguments for a detached, auto-restarting container with no published
 * host ports. Traffic reaches it through the proxy network.
 *
 * @param options - Container definition.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When a name, tag, label, key or mount is malformed.
 */
export function runContainerArgs(options: RunContainerOptions): string[] {
  assertMatches(options.containerName, NAME_PATTERN, "container name");
  assertMatches(options.imageTag, IMAGE_REFERENCE_PATTERN, "image tag");
  assertMatches(options.network, NAME_PATTERN, "network name");
  for (const key of options.environmentKeys) {
    assertMatches(key, ENVIRONMENT_KEY_PATTERN, "environment variable name");
  }
  return [
    "run",
    "--detach",
    "--name",
    options.containerName,
    "--network",
    options.network,
    "--restart",
    "unless-stopped",
    "--log-opt",
    "max-size=10m",
    "--log-opt",
    "max-file=3",
    ...labelArgs(options.labels),
    ...options.environmentKeys.flatMap((key) => ["--env", key]),
    ...mountArgs(options.volumes),
    ...resourceArgs(options.resources),
    options.imageTag,
    ...(options.command ?? []),
  ];
}

const MAX_STOP_GRACE_IN_SECONDS = 300;

/**
 * Builds `docker container stop` arguments: SIGTERM, then SIGKILL once the grace period ends.
 *
 * @param containerId - Container id.
 * @param graceInSeconds - Time the app gets to finish, between 0 and 300; Docker's default
 *   (10 s) when omitted.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When the id is malformed or the grace period is out of
 *   range.
 */
export function stopContainerArgs(containerId: string, graceInSeconds?: number): string[] {
  assertMatches(containerId, NAME_PATTERN, "container reference");
  if (graceInSeconds == null) {
    return ["container", "stop", containerId];
  }
  if (
    Number.isInteger(graceInSeconds) === false ||
    graceInSeconds < 0 ||
    graceInSeconds > MAX_STOP_GRACE_IN_SECONDS
  ) {
    throw new InvalidDockerArgumentError(`Invalid stop grace period: ${graceInSeconds}`);
  }
  return ["container", "stop", "--time", String(graceInSeconds), containerId];
}

/** Settings of the reverse proxy on a server the platform set up. */
export type ProxyOptions = {
  readonly network: string;
  readonly httpEntrypoint: string;
  readonly httpsEntrypoint: string;
  readonly certResolver: string;
  /** Let's Encrypt account e-mail; the account is created without one when null. */
  readonly acmeEmail: string | null;
  /** Directory on the server with the route files the proxy watches. */
  readonly routesDirectory: string;
};

/**
 * Builds `docker run` arguments for the Traefik proxy of a server: ports 80 and 443,
 * Let's Encrypt over HTTP-01, and the route files the worker writes. Labels of platform
 * containers are still read, for applications deployed before routes moved to files.
 *
 * @param options - Network, entrypoint names, certificate resolver, e-mail and route directory.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When a name or the e-mail is malformed.
 */
export function proxyContainerArgs(options: ProxyOptions): string[] {
  assertMatches(options.network, NAME_PATTERN, "network name");
  // Absolute, with no ".." segment, so the mount can never reach outside the directory.
  assertMatches(
    options.routesDirectory,
    /^(?:\/(?!\.\.(?:\/|$))[A-Za-z0-9._-]+)+$/,
    "route directory",
  );
  return [
    "run",
    "--detach",
    "--name",
    PROXY_CONTAINER_NAME,
    "--network",
    options.network,
    "--restart",
    "unless-stopped",
    "--publish",
    "80:80",
    "--publish",
    "443:443",
    "--label",
    `${LABELS.proxy}=true`,
    "--label",
    `${LABELS.proxyVersion}=${PROXY_VERSION}`,
    "--volume",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    "--volume",
    `${options.routesDirectory}:${PROXY_ROUTES_MOUNT}:ro`,
    "--volume",
    `${PROXY_CERTIFICATE_VOLUME}:/letsencrypt`,
    "--log-opt",
    "max-size=10m",
    "--log-opt",
    "max-file=3",
    PROXY_IMAGE,
    ...traefikArgs(options),
  ];
}

/** Traefik's own flags: where routes come from, entrypoints and Let's Encrypt. */
function traefikArgs(options: ProxyOptions): string[] {
  for (const name of [options.httpEntrypoint, options.httpsEntrypoint, options.certResolver]) {
    assertMatches(name, /^[a-zA-Z0-9_-]{1,64}$/, "Traefik name");
  }
  const resolver = `--certificatesresolvers.${options.certResolver}.acme`;
  const email =
    options.acmeEmail == null ? [] : [`${resolver}.email=${assertEmail(options.acmeEmail)}`];
  return [
    `--providers.file.directory=${PROXY_ROUTES_MOUNT}`,
    "--providers.file.watch=true",
    "--providers.docker=true",
    "--providers.docker.exposedbydefault=false",
    `--providers.docker.network=${options.network}`,
    `--providers.docker.constraints=Label(\`${LABELS.managed}\`,\`true\`)`,
    `--entrypoints.${options.httpEntrypoint}.address=:80`,
    `--entrypoints.${options.httpsEntrypoint}.address=:443`,
    ...email,
    `${resolver}.storage=/letsencrypt/acme.json`,
    `${resolver}.httpchallenge.entrypoint=${options.httpEntrypoint}`,
    "--api.dashboard=false",
    "--log.level=INFO",
  ];
}

function assertEmail(email: string): string {
  assertMatches(email, /^[^\s@,=]+@[^\s@,=]+\.[^\s@,=]+$/, "e-mail");
  return email;
}

/**
 * Validates a container name or id before it reaches the docker CLI.
 *
 * @param reference - Container name or id.
 * @returns The same reference.
 * @throws {InvalidDockerArgumentError} When it could be read as an option or is malformed.
 */
export function assertContainerReference(reference: string): string {
  assertMatches(reference, NAME_PATTERN, "container reference");
  return reference;
}

/**
 * Validates an image reference before it reaches the docker CLI.
 *
 * @param imageTag - Image reference such as "nelcota/api:abc".
 * @returns The same reference.
 * @throws {InvalidDockerArgumentError} When it is malformed.
 */
export function assertImageReference(imageTag: string): string {
  assertMatches(imageTag, IMAGE_REFERENCE_PATTERN, "image tag");
  return imageTag;
}

// Absolute, with no ".." segment and no ":" that docker cp would read as a container name.
const FILE_PATH_PATTERN = /^(?:\/(?!\.\.(?:\/|$))[A-Za-z0-9._-]+)+$/;

/**
 * Validates a file path for `docker cp`, on the host or inside a container.
 *
 * @param path - Absolute path.
 * @returns The same path.
 * @throws {InvalidDockerArgumentError} When it is relative, climbs with ".." or has unusual
 *   characters.
 */
export function assertFilePath(path: string): string {
  assertMatches(path, FILE_PATH_PATTERN, "file path");
  return path;
}
