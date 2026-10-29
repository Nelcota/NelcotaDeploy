import { dirname, join, resolve } from "node:path";

import { z } from "zod";

const MIN_AUTH_SECRET_LENGTH = 32;
const ENCRYPTION_KEY_BYTES = 32;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

/** Allowed values and default of a numeric setting. */
type IntegerRange = { readonly min: number; readonly max: number; readonly fallback: number };

const WORKER_CONCURRENCY_RANGE: IntegerRange = { min: 1, max: 8, fallback: 2 };
const BUILD_TIMEOUT_SECONDS_RANGE: IntegerRange = { min: 60, max: 7200, fallback: 1200 };
const HEALTH_CHECK_TIMEOUT_SECONDS_RANGE: IntegerRange = { min: 5, max: 600, fallback: 60 };
const METRICS_INTERVAL_SECONDS_RANGE: IntegerRange = { min: 5, max: 3600, fallback: 15 };
const METRICS_RETENTION_HOURS_RANGE: IntegerRange = { min: 1, max: 720, fallback: 48 };
const RUNTIME_LOG_RETENTION_LINES_RANGE: IntegerRange = { min: 100, max: 100_000, fallback: 5000 };
const DEPLOYMENT_LOG_RETENTION_DAYS_RANGE: IntegerRange = { min: 1, max: 365, fallback: 30 };
const IMAGES_KEPT_PER_PROJECT_RANGE: IntegerRange = { min: 1, max: 50, fallback: 5 };
const BACKUPS_KEPT_RANGE: IntegerRange = { min: 1, max: 365, fallback: 7 };

function boundedInteger(range: IntegerRange) {
  return z.coerce.number().int().min(range.min).max(range.max).default(range.fallback);
}

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default(false);

const encryptionKeySchema = z
  .string()
  .trim()
  .refine((value) => Buffer.from(value, "base64").byteLength === ENCRYPTION_KEY_BYTES, {
    message: `must be ${ENCRYPTION_KEY_BYTES} random bytes encoded as base64`,
  });

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  LOG_STREAM: z.enum(["stdout", "stderr"]).default("stdout"),
  PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT),
  DATABASE_PATH: z.string().trim().min(1).default("./data/nelcota.db"),
  WORKSPACE_DIR: z.string().trim().min(1).default("./data/workspaces"),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).default(`http://localhost:${DEFAULT_PORT}`),
  BETTER_AUTH_SECRET: z.string().min(MIN_AUTH_SECRET_LENGTH).optional(),
  NELCOTA_ENCRYPTION_KEY: encryptionKeySchema.optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  DOCKER_BINARY: z.string().trim().min(1).default("docker"),
  GIT_BINARY: z.string().trim().min(1).default("git"),
  DOCKER_NETWORK: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/)
    .default("nelcota"),
  TRAEFIK_HTTP_ENTRYPOINT: z.string().min(1).default("web"),
  TRAEFIK_HTTPS_ENTRYPOINT: z.string().min(1).default("websecure"),
  TRAEFIK_CERT_RESOLVER: z.string().min(1).default("letsencrypt"),
  TRAEFIK_ENABLED: booleanFromString,
  // Directory, shared with the panel's proxy, where the worker writes application routes.
  TRAEFIK_ROUTES_DIR: z.string().trim().min(1).optional(),
  // Let's Encrypt account e-mail for the proxies the platform starts on other servers.
  ACME_EMAIL: z.union([z.email(), z.literal("").transform(() => undefined)]).optional(),
  WORKER_CONCURRENCY: boundedInteger(WORKER_CONCURRENCY_RANGE),
  BUILD_TIMEOUT_SECONDS: boundedInteger(BUILD_TIMEOUT_SECONDS_RANGE),
  HEALTH_CHECK_TIMEOUT_SECONDS: boundedInteger(HEALTH_CHECK_TIMEOUT_SECONDS_RANGE),
  METRICS_INTERVAL_SECONDS: boundedInteger(METRICS_INTERVAL_SECONDS_RANGE),
  METRICS_RETENTION_HOURS: boundedInteger(METRICS_RETENTION_HOURS_RANGE),
  RUNTIME_LOG_RETENTION_LINES: boundedInteger(RUNTIME_LOG_RETENTION_LINES_RANGE),
  DEPLOYMENT_LOG_RETENTION_DAYS: boundedInteger(DEPLOYMENT_LOG_RETENTION_DAYS_RANGE),
  IMAGES_KEPT_PER_PROJECT: boundedInteger(IMAGES_KEPT_PER_PROJECT_RANGE),
  // Daily database copies; the directory defaults to "backups" next to the database file.
  BACKUP_DIR: z.string().trim().min(1).optional(),
  BACKUPS_KEPT: boundedInteger(BACKUPS_KEPT_RANGE),
  NELCOTA_MCP_TOKEN: z.string().min(1).optional(),
  SCHEDULE_TIME_ZONE: z
    .string()
    .refine(isKnownTimeZone, { message: "must be an IANA time zone" })
    .default("America/Sao_Paulo"),
});

/** Validated process configuration. Paths are absolute. */
export type AppConfig = z.infer<typeof configSchema>;

/** Thrown when environment variables are missing or invalid. */
export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

let cachedConfig: AppConfig | undefined;

/**
 * Parses configuration from environment variables.
 *
 * @param environment - Variables to read, usually `process.env`.
 * @returns The validated configuration with absolute paths.
 * @throws {InvalidConfigError} When a variable is present but invalid.
 */
export function parseConfig(environment: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(environment);
  if (result.success === false) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new InvalidConfigError(`Invalid configuration: ${problems}`);
  }
  return {
    ...result.data,
    DATABASE_PATH: resolveDatabasePath(result.data.DATABASE_PATH),
    WORKSPACE_DIR: resolve(result.data.WORKSPACE_DIR),
    BACKUP_DIR: resolveBackupDirectory(result.data.BACKUP_DIR, result.data.DATABASE_PATH),
  };
}

/** An in-memory database has nothing to back up, so it gets no directory. */
function resolveBackupDirectory(directory: string | undefined, databasePath: string) {
  if (directory != null) {
    return resolve(directory);
  }
  return databasePath === ":memory:" ? undefined : join(dirname(resolve(databasePath)), "backups");
}

function resolveDatabasePath(path: string): string {
  if (path === ":memory:") {
    return path;
  }
  return resolve(path);
}

/**
 * Returns the process configuration, parsing `process.env` on first use.
 *
 * @throws {InvalidConfigError} When a variable is invalid.
 */
export function getConfig(): AppConfig {
  cachedConfig ??= parseConfig(process.env);
  return cachedConfig;
}

/**
 * Returns a configuration value that a process cannot run without.
 *
 * @param key - Name of the optional variable that is required here.
 * @returns The variable value.
 * @throws {InvalidConfigError} When the variable is not set.
 */
export function requireConfigValue<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
  const value = getConfig()[key];
  if (value == null) {
    throw new InvalidConfigError(`Missing required environment variable ${String(key)}`);
  }
  return value;
}
