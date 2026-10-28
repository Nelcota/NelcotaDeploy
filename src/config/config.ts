import { resolve } from "node:path";

import { z } from "zod";

const MIN_AUTH_SECRET_LENGTH = 32;
const ENCRYPTION_KEY_BYTES = 32;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

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
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  BUILD_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(7200).default(1200),
  HEALTH_CHECK_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  METRICS_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(15),
  METRICS_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  RUNTIME_LOG_RETENTION_LINES: z.coerce.number().int().min(100).max(100_000).default(5000),
  DEPLOYMENT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  IMAGES_KEPT_PER_PROJECT: z.coerce.number().int().min(1).max(50).default(5),
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
  };
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
