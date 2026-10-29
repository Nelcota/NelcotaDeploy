import { InvalidDockerArgumentError } from "./docker.errors";

/** Labels that mark resources owned by the platform. Nothing without them is ever touched. */
export const LABELS = {
  managed: "io.nelcota.managed",
  projectId: "io.nelcota.project-id",
  projectSlug: "io.nelcota.project-slug",
  deploymentId: "io.nelcota.deployment-id",
  /** The reverse proxy the platform runs on a remote server. Never an application. */
  proxy: "io.nelcota.proxy",
} as const;

/** Name of the reverse proxy container on servers the platform set up. */
export const PROXY_CONTAINER_NAME = "nelcota-proxy";
/** Same Traefik release the panel's own Docker Compose stack uses. */
const PROXY_IMAGE = "traefik:v3.7.16";
const PROXY_CERTIFICATE_VOLUME = "nelcota-letsencrypt";
const COMPRESS_MIDDLEWARE = "nelcota-compress";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const IMAGE_REFERENCE_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL_KEY_PATTERN = /^[a-z0-9][a-z0-9._/-]*[a-z0-9]$/i;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IMAGE_REPOSITORY = "nelcota";
const SHORT_ID_LENGTH = 12;
const MAX_PORT = 65_535;

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

/** Routing settings for one public hostname. */
export type RoutedDomain = { readonly hostname: string; readonly httpsEnabled: boolean };

/** Labels of the routers for one hostname: HTTPS with a redirect from HTTP, or plain HTTP. */
function routerLabels(
  input: {
    readonly httpEntrypoint: string;
    readonly httpsEntrypoint: string;
    readonly certResolver: string;
    readonly compress: boolean;
  },
  route: { readonly service: string; readonly router: string; readonly domain: RoutedDomain },
): Record<string, string> {
  const { service, router, domain } = route;
  assertMatches(domain.hostname, /^[a-z0-9.-]+$/, "hostname");
  const labels: Record<string, string> = {
    [`traefik.http.routers.${router}.rule`]: `Host(\`${domain.hostname}\`)`,
    [`traefik.http.routers.${router}.service`]: service,
  };
  if (input.compress) {
    labels[`traefik.http.routers.${router}.middlewares`] = COMPRESS_MIDDLEWARE;
  }
  if (domain.httpsEnabled === false) {
    labels[`traefik.http.routers.${router}.entrypoints`] = input.httpEntrypoint;
    return labels;
  }
  labels[`traefik.http.routers.${router}.entrypoints`] = input.httpsEntrypoint;
  labels[`traefik.http.routers.${router}.tls`] = "true";
  labels[`traefik.http.routers.${router}.tls.certresolver`] = input.certResolver;
  const redirect = `${router}-http`;
  labels[`traefik.http.routers.${redirect}.rule`] = `Host(\`${domain.hostname}\`)`;
  labels[`traefik.http.routers.${redirect}.entrypoints`] = input.httpEntrypoint;
  labels[`traefik.http.routers.${redirect}.middlewares`] = "nelcota-https-redirect";
  labels[`traefik.http.routers.${redirect}.service`] = service;
  return labels;
}

/**
 * Builds Traefik labels that route each hostname to the container's internal port.
 *
 * @param input - Project slug, hostnames, port and Traefik entrypoints.
 * @returns Label map; empty when there are no domains.
 * @throws {InvalidDockerArgumentError} When the port or a hostname is invalid.
 */
export function traefikLabels(input: {
  readonly projectSlug: string;
  readonly domains: readonly RoutedDomain[];
  readonly internalPort: number;
  readonly network: string;
  readonly httpEntrypoint: string;
  readonly httpsEntrypoint: string;
  readonly certResolver: string;
  /** Compresses responses; off where the proxy already compresses on its entrypoint. */
  readonly compress: boolean;
}): Record<string, string> {
  if (input.domains.length === 0) {
    return {};
  }
  assertMatches(input.projectSlug, SLUG_PATTERN, "project slug");
  if (
    Number.isInteger(input.internalPort) === false ||
    input.internalPort < 1 ||
    input.internalPort > MAX_PORT
  ) {
    throw new InvalidDockerArgumentError(`Invalid internal port: ${input.internalPort}`);
  }
  const service = `nelcota-${input.projectSlug}`;
  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": input.network,
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(input.internalPort),
  };
  input.domains.forEach((domain, index) => {
    Object.assign(labels, routerLabels(input, { service, router: `${service}-${index}`, domain }));
  });
  labels["traefik.http.middlewares.nelcota-https-redirect.redirectscheme.scheme"] = "https";
  if (input.compress) {
    labels[`traefik.http.middlewares.${COMPRESS_MIDDLEWARE}.compress`] = "true";
  }
  return labels;
}

/** Settings of the reverse proxy on a server the platform set up. */
export type ProxyOptions = {
  readonly network: string;
  readonly httpEntrypoint: string;
  readonly httpsEntrypoint: string;
  readonly certResolver: string;
  /** Let's Encrypt account e-mail; the account is created without one when null. */
  readonly acmeEmail: string | null;
};

/**
 * Builds `docker run` arguments for the Traefik proxy of a server: ports 80 and 443,
 * Let's Encrypt over HTTP-01, and routing only for platform application containers.
 *
 * @param options - Network, entrypoint names, certificate resolver and e-mail.
 * @returns Arguments after the docker binary.
 * @throws {InvalidDockerArgumentError} When a name or the e-mail is malformed.
 */
export function proxyContainerArgs(options: ProxyOptions): string[] {
  assertMatches(options.network, NAME_PATTERN, "network name");
  for (const name of [options.httpEntrypoint, options.httpsEntrypoint, options.certResolver]) {
    assertMatches(name, /^[a-zA-Z0-9_-]{1,64}$/, "Traefik name");
  }
  const resolver = `--certificatesresolvers.${options.certResolver}.acme`;
  const email =
    options.acmeEmail == null ? [] : [`${resolver}.email=${assertEmail(options.acmeEmail)}`];
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
    "--volume",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    "--volume",
    `${PROXY_CERTIFICATE_VOLUME}:/letsencrypt`,
    "--log-opt",
    "max-size=10m",
    "--log-opt",
    "max-file=3",
    PROXY_IMAGE,
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
