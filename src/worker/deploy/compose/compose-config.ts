import { posix } from "node:path";

import { isPathInsideWorkspace } from "../workspace";
import { InvalidComposeFileError } from "./compose.errors";

/** A Compose model as `docker compose config --format json` prints it, already normalized. */
export type ComposeModel = {
  readonly services: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly volumes: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly networks: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly other: Readonly<Record<string, unknown>>;
};

/** What the deployment needs to know about a Compose file that passed the checks. */
export type CheckedCompose = {
  readonly model: ComposeModel;
  /** Host files the model reads, such as env files and build contexts, as absolute paths. */
  readonly hostPaths: readonly string[];
};

// Service settings that reach the server itself or other projects' containers.
const FORBIDDEN_LISTS = [
  "cap_add",
  "devices",
  "device_cgroup_rules",
  "security_opt",
  "volumes_from",
  "ports",
  "post_start",
  "pre_stop",
  "label_file",
] as const;
const FORBIDDEN_SETTINGS = [
  "container_name",
  "cgroup_parent",
  "runtime",
  "cgroup",
  "use_api_socket",
  "provider",
  "network_mode",
  "credential_spec",
  "develop",
] as const;
const NAMESPACE_SETTINGS = ["pid", "ipc", "uts", "userns_mode"] as const;
const FORBIDDEN_BUILD_SETTINGS = [
  "additional_contexts",
  "ssh",
  "secrets",
  "entitlements",
  "privileged",
  "cache_from",
  "cache_to",
  "tags",
] as const;
const ALLOWED_MOUNT_TYPES = new Set(["volume", "tmpfs"]);
const ALLOWED_NETWORK_DRIVERS = new Set(["bridge"]);
const PLATFORM_LABEL_PREFIX = "io.nelcota.";
const PROXY_LABEL_PREFIX = "traefik.";

/**
 * Checks the raw Compose file before Docker reads it: includes and extended files would let
 * the model pull in files from anywhere on the server.
 *
 * @param source - Text of the Compose file, as YAML.
 * @throws {InvalidComposeFileError} When the file includes or extends other files, or is not a
 * Compose mapping.
 */
export function checkComposeSource(source: string): void {
  const parsed: unknown = Bun.YAML.parse(source);
  if (isRecord(parsed) === false) {
    throw new InvalidComposeFileError(["the file is not a Compose mapping"]);
  }
  const problems: string[] = [];
  if (Object.hasOwn(parsed, "include")) {
    problems.push("include is not supported; keep every service in one file");
  }
  const services = isRecord(parsed["services"]) ? parsed["services"] : {};
  for (const [name, service] of Object.entries(services)) {
    if (isRecord(service) && isRecord(service["extends"]) && service["extends"]["file"] != null) {
      problems.push(`service ${name}: extends from another file is not supported`);
    }
    // Compose reads label files while normalizing, before the model can be checked.
    if (isRecord(service) && service["label_file"] != null) {
      problems.push(`service ${name}: label_file is not supported`);
    }
  }
  if (problems.length > 0) {
    throw new InvalidComposeFileError(problems);
  }
}

/**
 * Checks a normalized Compose model against what a project may run: nothing that reaches the
 * server, its other containers or files outside the repository.
 *
 * @param config - Output of `docker compose config --format json --no-env-resolution`.
 * @param options - The `routedService` that receives the domains and the `repositoryPath`
 *   every host file must stay in.
 * @returns The model and the host paths that must still be resolved against symlinks.
 * @throws {InvalidComposeFileError} With every problem found, when there is any.
 */
export function checkComposeConfig(
  config: unknown,
  options: { readonly routedService: string; readonly repositoryPath: string },
): CheckedCompose {
  if (isRecord(config) === false || isRecord(config["services"]) === false) {
    throw new InvalidComposeFileError(["the file defines no services"]);
  }
  const model = toModel(config);
  const problems: string[] = [];
  const hostPaths = new Set<string>();
  if (Object.hasOwn(model.services, options.routedService) === false) {
    problems.push(`the service ${options.routedService} that receives the domains is missing`);
  }
  for (const [name, service] of Object.entries(model.services)) {
    if (name.toLowerCase().startsWith("nelcota-")) {
      problems.push(`service ${name}: the nelcota- name prefix is reserved`);
    }

    problems.push(...serviceProblems(service).map((problem) => `service ${name}: ${problem}`));
    for (const path of serviceHostPaths(service)) {
      hostPaths.add(path);
    }
  }
  problems.push(...topLevelProblems(model));
  for (const path of [
    ...fileReferences(model.other["secrets"]),
    ...fileReferences(model.other["configs"]),
  ]) {
    hostPaths.add(path);
  }
  for (const path of hostPaths) {
    if (isPathInsideWorkspace(options.repositoryPath, path) === false) {
      problems.push(`${path} is outside the repository`);
    }
  }
  if (problems.length > 0) {
    throw new InvalidComposeFileError(problems);
  }
  return { model, hostPaths: [...hostPaths] };
}

function serviceProblems(service: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  if (service["privileged"] === true) {
    problems.push("privileged is not allowed");
  }
  for (const setting of FORBIDDEN_LISTS) {
    if (isNonEmpty(service[setting])) {
      problems.push(`${setting} is not allowed`);
    }
  }
  for (const setting of FORBIDDEN_SETTINGS) {
    if (service[setting] != null) {
      problems.push(`${setting} is not allowed`);
    }
  }
  for (const setting of NAMESPACE_SETTINGS) {
    if (sharesNamespace(service[setting])) {
      problems.push(`${setting} cannot share the server's or another container's namespace`);
    }
  }
  problems.push(...mountProblems(service["volumes"]), ...labelProblems(service["labels"]));
  problems.push(...buildProblems(service["build"]));
  return problems;
}

function mountProblems(volumes: unknown): string[] {
  if (Array.isArray(volumes) === false) {
    return [];
  }
  return volumes
    .filter(
      (mount) =>
        isRecord(mount) === false || ALLOWED_MOUNT_TYPES.has(String(mount["type"])) === false,
    )
    .map((mount) => {
      const type = isRecord(mount) ? String(mount["type"]) : "unknown";
      return `${type} mounts are not allowed; use named volumes`;
    });
}

function labelProblems(labels: unknown): string[] {
  if (isRecord(labels) === false) {
    return [];
  }
  return Object.keys(labels)
    .filter((key) => {
      const normalized = key.toLowerCase();
      return (
        normalized.startsWith(PLATFORM_LABEL_PREFIX) || normalized.startsWith(PROXY_LABEL_PREFIX)
      );
    })
    .map((key) => `the label ${key} belongs to the platform`);
}

function buildProblems(build: unknown): string[] {
  if (build == null) {
    return [];
  }
  if (isRecord(build) === false) {
    return ["build must be a mapping"];
  }
  const problems = FORBIDDEN_BUILD_SETTINGS.filter((setting) => isNonEmpty(build[setting])).map(
    (setting) => `build.${setting} is not allowed`,
  );
  problems.push(...labelProblems(build["labels"]));
  if (build["network"] != null && build["network"] !== "default" && build["network"] !== "none") {
    problems.push("build.network must be default or none");
  }
  const context = build["context"];
  if (typeof context !== "string" || posix.isAbsolute(context) === false) {
    problems.push("build.context must be a folder of the repository");
  }
  return problems;
}

function serviceHostPaths(service: Readonly<Record<string, unknown>>): string[] {
  const envFiles: unknown = service["env_file"];
  const entries: readonly unknown[] = Array.isArray(envFiles) ? envFiles : [];
  // A path that is not a string fails the inside-the-repository check that follows.
  const paths = entries.map((envFile) => {
    const path = isRecord(envFile) ? envFile["path"] : envFile;
    return typeof path === "string" ? path : "";
  });
  const build = service["build"];
  if (
    isRecord(build) &&
    typeof build["context"] === "string" &&
    posix.isAbsolute(build["context"])
  ) {
    paths.push(build["context"]);
    if (build["dockerfile_inline"] == null) {
      const dockerfile =
        typeof build["dockerfile"] === "string" ? build["dockerfile"] : "Dockerfile";
      paths.push(posix.resolve(build["context"], dockerfile));
    }
  }
  return paths;
}

function topLevelProblems(model: ComposeModel): string[] {
  return [
    ...Object.entries(model.volumes).flatMap(([name, volume]) => volumeProblems(name, volume)),
    ...Object.entries(model.networks).flatMap(([name, network]) => networkProblems(name, network)),
    ...externalProblems("secrets", model.other["secrets"]),
    ...externalProblems("configs", model.other["configs"]),
    ...(isNonEmpty(model.other["models"]) ? ["models are not supported"] : []),
  ];
}

function volumeProblems(name: string, volume: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  if (volume["external"] === true) {
    problems.push(`volume ${name}: external volumes are not allowed`);
  }
  if (volume["driver"] != null && volume["driver"] !== "local") {
    problems.push(`volume ${name}: only the local driver is allowed`);
  }
  if (isNonEmpty(volume["driver_opts"])) {
    problems.push(`volume ${name}: driver_opts are not allowed`);
  }
  return problems;
}

function networkProblems(name: string, network: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  if (network["external"] === true) {
    problems.push(`network ${name}: external networks are not allowed`);
  }
  if (isNonEmpty(network["driver_opts"])) {
    problems.push(`network ${name}: driver_opts are not allowed`);
  }
  const driver = network["driver"];
  if (
    driver != null &&
    (typeof driver !== "string" || ALLOWED_NETWORK_DRIVERS.has(driver) === false)
  ) {
    problems.push(`network ${name}: only the bridge driver is allowed`);
  }
  return problems;
}

function externalProblems(kind: "secrets" | "configs", entries: unknown): string[] {
  if (isRecord(entries) === false) {
    return [];
  }
  return Object.entries(entries).flatMap(([name, entry]) => {
    if (isRecord(entry) === false) {
      return [];
    }
    const problems: string[] = [];
    if (entry["external"] === true) {
      problems.push(`${kind} ${name}: external ${kind} are not allowed`);
    }
    if (entry["environment"] != null) {
      problems.push(`${kind} ${name}: host environment sources are not allowed`);
    }
    return problems;
  });
}

function fileReferences(entries: unknown): string[] {
  if (isRecord(entries) === false) {
    return [];
  }
  return Object.values(entries).flatMap((entry) =>
    isRecord(entry) && typeof entry["file"] === "string" ? [entry["file"]] : [],
  );
}

function toModel(config: Record<string, unknown>): ComposeModel {
  const { services, volumes, networks, ...other } = config;
  return {
    services: recordsOf(services),
    volumes: recordsOf(volumes),
    networks: recordsOf(networks),
    other,
  };
}

/** Keeps the entries that are mappings; Compose writes an empty entry as null. */
function recordsOf(value: unknown): Record<string, Readonly<Record<string, unknown>>> {
  if (isRecord(value) === false) {
    return {};
  }
  const records: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [name, entry] of Object.entries(value)) {
    records[name] = isRecord(entry) ? entry : {};
  }
  return records;
}

function sharesNamespace(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value === "host" || value.startsWith("container:") || value.startsWith("service:");
}

function isNonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return value != null && value !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && Array.isArray(value) === false;
}
