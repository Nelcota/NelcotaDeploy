import { InvalidDockerArgumentError } from "./docker.errors";

/** Labels that mark resources owned by the platform. Nothing without them is ever touched. */
export const LABELS = {
  managed: "io.nelcota.managed",
  projectId: "io.nelcota.project-id",
  projectSlug: "io.nelcota.project-slug",
  deploymentId: "io.nelcota.deployment-id",
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
 * Builds the platform labels for a deployment's image and container.
 *
 * @param input - Owning project and deployment.
 * @returns Label map.
 */
export function managedLabels(input: {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly deploymentId: string;
}): Record<string, string> {
  return {
    [LABELS.managed]: "true",
    [LABELS.projectId]: input.projectId,
    [LABELS.projectSlug]: input.projectSlug,
    [LABELS.deploymentId]: input.deploymentId,
  };
}

function labelArgs(labels: Readonly<Record<string, string>>): string[] {
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

/** Options for {@link runContainerArgs}. */
export type RunContainerOptions = {
  readonly containerName: string;
  readonly imageTag: string;
  readonly network: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Names passed as `--env NAME`; docker reads each value from its own environment. */
  readonly environmentKeys: readonly string[];
};

/**
 * Builds `docker run` arguments for a detached, auto-restarting container with no published
 * host ports. Traffic reaches it through the proxy network.
 *
 * @param options - Container definition.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When a name, tag, label or key is malformed.
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
    options.imageTag,
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
