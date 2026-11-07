import type { ComposeModel } from "./compose-config";

/** Key of the platform network in the file; the proxy reaches the routed service through it. */
const PLATFORM_NETWORK_KEY = "nelcota-platform";
const MILLICORES_PER_CORE = 1000;

/** What the platform adds to the model before Compose starts it. */
export type ComposeFileOptions = {
  /** Project-scoped prefix for every created resource, independent of names in the source. */
  readonly projectName: string;
  readonly routedService: string;
  /** Name of the platform's Docker network, which the proxy and managed databases are on. */
  readonly network: string;
  /** Labels of every container, volume, network and image of the project. */
  readonly projectLabels: Readonly<Record<string, string>>;
  /** Extra labels of the routed service, such as its deployment. */
  readonly routedLabels: Readonly<Record<string, string>>;
  /** Variables of the project; Compose takes their values from its own environment. */
  readonly environmentKeys: readonly string[];
  readonly memoryLimitInMb: number | null;
  readonly cpuLimitInMillicores: number | null;
};

/**
 * Builds the Compose file a deployment runs: the checked model, with every service on the
 * platform network, labelled as the project's and given the project's variables and limits.
 *
 * @remarks
 * Variables are listed by name only, so their values come from the environment of
 * `docker compose up` and never reach the file. A service keeps its own value for a variable
 * it sets itself, and its own restart policy.
 *
 * @param model - Model that passed {@link checkComposeConfig}.
 * @param options - Routed service, network, labels, variables and limits.
 * @returns The file contents, as an object to write as JSON.
 * @throws {Error} When the file already uses the key of the platform network.
 */
export function composeFileFor(
  model: ComposeModel,
  options: ComposeFileOptions,
): Record<string, unknown> {
  if (Object.hasOwn(model.networks, PLATFORM_NETWORK_KEY)) {
    throw new Error(`The Compose file must not define a network named ${PLATFORM_NETWORK_KEY}`);
  }
  const services = Object.fromEntries(
    Object.entries(model.services).map(([name, service]) => [
      name,
      serviceFor(service, {
        ...options,
        imageName: `${options.projectName}-${name}`,
        labels:
          name === options.routedService
            ? { ...options.projectLabels, ...options.routedLabels }
            : options.projectLabels,
      }),
    ]),
  );
  const networks = Object.fromEntries(
    Object.entries(model.networks).map(([name, network]) => [
      name,
      withLabels({ ...network, name: `${options.projectName}_${name}` }, options.projectLabels),
    ]),
  );
  const volumes = Object.fromEntries(
    Object.entries(model.volumes).map(([name, volume]) => [
      name,
      withLabels({ ...volume, name: `${options.projectName}_${name}` }, options.projectLabels),
    ]),
  );
  return {
    ...model.other,
    services,
    networks: { ...networks, [PLATFORM_NETWORK_KEY]: { name: options.network, external: true } },
    volumes,
  };
}

function serviceFor(
  service: Readonly<Record<string, unknown>>,
  options: ComposeFileOptions & {
    readonly labels: Readonly<Record<string, string>>;
    readonly imageName: string;
  },
): Record<string, unknown> {
  const inherited = Object.fromEntries(options.environmentKeys.map((key) => [key, null]));
  const build = service["build"];
  return {
    ...service,
    labels: { ...recordOf(service["labels"]), ...options.labels },
    // The model always lists a service's networks; "default" when the file named none.
    networks: { ...recordOf(service["networks"]), [PLATFORM_NETWORK_KEY]: null },
    environment: { ...inherited, ...recordOf(service["environment"]) },
    restart: service["restart"] ?? "unless-stopped",
    ...(isRecord(build)
      ? {
          image: options.imageName,
          build: { ...build, labels: { ...recordOf(build["labels"]), ...options.projectLabels } },
        }
      : {}),
    ...(options.memoryLimitInMb == null ? {} : { mem_limit: `${options.memoryLimitInMb}m` }),
    ...(options.cpuLimitInMillicores == null
      ? {}
      : { cpus: options.cpuLimitInMillicores / MILLICORES_PER_CORE }),
  };
}

function withLabels(
  entry: Readonly<Record<string, unknown>>,
  labels: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return { ...entry, labels: { ...recordOf(entry["labels"]), ...labels } };
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && Array.isArray(value) === false;
}
