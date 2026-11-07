import { z } from "zod";

const MAX_NAME_LENGTH = 64;
export const MAX_SLUG_LENGTH = 40;
const MAX_RELATIVE_PATH_LENGTH = 200;
const MAX_BRANCH_LENGTH = 200;
const MAX_PORT = 65_535;
const MAX_TOKEN_LENGTH = 512;
/** How a project's image can be built. */
export const PROJECT_BUILDERS = ["dockerfile", "railpack", "compose"] as const;

export type ProjectBuilder = (typeof PROJECT_BUILDERS)[number];
const DEFAULT_COMPOSE_FILE = "compose.yaml";
const MAX_COMPOSE_SERVICE_LENGTH = 63;
// Lowercase Compose service names, so the container Compose creates has a predictable name.
const COMPOSE_SERVICE_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;
/** Smallest memory limit Docker accepts with room for a real application, in MiB. */
export const MIN_MEMORY_LIMIT_IN_MB = 64;
export const MAX_MEMORY_LIMIT_IN_MB = 1_048_576;
/** CPU limits offered in the interface, in thousandths of a core. */
export const CPU_LIMIT_OPTIONS_IN_MILLICORES = [250, 500, 1000, 2000, 4000, 8000] as const;
export const MIN_CPU_LIMIT_IN_MILLICORES = 100;
export const MAX_CPU_LIMIT_IN_MILLICORES = 256_000;
/** Most containers one deployment runs behind the load balancer. */
export const MAX_REPLICAS = 10;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const GITHUB_URL_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const HEALTH_CHECK_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/;

/** Owner and name of a GitHub repository, parsed from its URL. */
export type GitHubRepository = {
  readonly owner: string;
  readonly name: string;
  /** Lowercase "owner/name", used to match webhook payloads. */
  readonly fullName: string;
  /** Canonical HTTPS clone URL without credentials. */
  readonly cloneUrl: string;
};

/**
 * Parses a public GitHub HTTPS URL.
 *
 * @param url - URL such as "https://github.com/acme/api" or ".../api.git".
 * @returns The repository, or undefined when the URL is not a GitHub repository URL.
 */
export function parseGitHubRepository(url: string): GitHubRepository | undefined {
  const match = GITHUB_URL_PATTERN.exec(url.trim());
  const owner = match?.[1];
  const name = match?.[2];
  if (owner == null || name == null || name === "." || name === "..") {
    return undefined;
  }
  return {
    owner,
    name,
    fullName: `${owner}/${name}`.toLowerCase(),
    cloneUrl: `https://github.com/${owner}/${name}.git`,
  };
}

/**
 * Builds a slug from a project name: lowercase ASCII letters, digits and hyphens.
 *
 * @param name - Human-readable project name.
 * @returns A slug, or an empty string when the name has no usable characters.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replaceAll(/-+$/g, "");
}

/**
 * Tells whether a git branch name is safe to pass to git as a ref.
 *
 * @param branch - Branch name without "refs/heads/".
 * @returns True for names git accepts that cannot be confused with options.
 */
export function isValidBranchName(branch: string): boolean {
  if (branch.length === 0 || branch.length > MAX_BRANCH_LENGTH) {
    return false;
  }
  if (BRANCH_PATTERN.test(branch) === false) {
    return false;
  }
  return breaksGitRefRules(branch) === false;
}

// Rules from `git check-ref-format` that the character pattern alone cannot express.
const FORBIDDEN_BRANCH_PREFIXES = ["-", "/"] as const;
const FORBIDDEN_BRANCH_SUFFIXES = ["/", ".", ".lock"] as const;
const FORBIDDEN_BRANCH_SEQUENCES = ["..", "//", "/."] as const;

function breaksGitRefRules(branch: string): boolean {
  return (
    FORBIDDEN_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix)) ||
    FORBIDDEN_BRANCH_SUFFIXES.some((suffix) => branch.endsWith(suffix)) ||
    FORBIDDEN_BRANCH_SEQUENCES.some((sequence) => branch.includes(sequence))
  );
}

/**
 * Tells whether a path is relative and stays inside the repository.
 *
 * @param path - Path such as "Dockerfile" or "apps/api".
 * @returns True when the path has no absolute prefix and no ".." segment.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_RELATIVE_PATH_LENGTH) {
    return false;
  }
  if (RELATIVE_PATH_PATTERN.test(path) === false || path.startsWith("/")) {
    return false;
  }
  return path.split("/").includes("..") === false;
}

const trimmedText = (maxLength: number) =>
  z
    .string()
    .transform((value) => value.normalize("NFC").trim())
    .pipe(
      z.string().min(1, "Campo obrigatório").max(maxLength, `Máximo de ${maxLength} caracteres`),
    );

const projectSlugSchema = z
  .string()
  .trim()
  .min(1, "Campo obrigatório")
  .max(MAX_SLUG_LENGTH, `Máximo de ${MAX_SLUG_LENGTH} caracteres`)
  .regex(SLUG_PATTERN, "Use letras minúsculas, números e hífens");

const repositoryUrlSchema = z
  .string()
  .trim()
  .refine((value) => parseGitHubRepository(value) != null, {
    message: "Informe a URL HTTPS de um repositório GitHub (https://github.com/dono/repo)",
  });

const relativePathSchema = z
  .string()
  .trim()
  .refine(isSafeRelativePath, { message: "Use um caminho relativo dentro do repositório" });

const healthCheckPathSchema = z
  .string()
  .trim()
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine((value) => value === "" || HEALTH_CHECK_PATH_PATTERN.test(value), {
    message: "O caminho deve começar com / e não conter espaços",
  })
  .transform((value) => (value === "" ? null : value));

/** A whole number between the bounds, or blank or absent for none, as before limits existed. */
function optionalLimit(bounds: {
  readonly min: number;
  readonly max: number;
  readonly rangeMessage: string;
}) {
  return z
    .union([
      z
        .literal("")
        .or(z.null())
        .transform(() => null),
      z.coerce
        .number()
        .int("Informe um número inteiro")
        .min(bounds.min, bounds.rangeMessage)
        .max(bounds.max, bounds.rangeMessage),
    ])
    .default(null);
}

/** Fields accepted when creating or editing a project. */
export const projectInputSchema = z
  .object({
    name: trimmedText(MAX_NAME_LENGTH),
    slug: projectSlugSchema,
    repositoryUrl: repositoryUrlSchema,
    branch: z.string().trim().refine(isValidBranchName, { message: "Nome de branch inválido" }),
    /** The repository's Dockerfile, or Railpack detecting the stack; Dockerfile when absent. */
    builder: z.enum(PROJECT_BUILDERS).default("dockerfile"),
    dockerfilePath: relativePathSchema,
    buildContext: z
      .string()
      .trim()
      .refine((value) => value === "." || isSafeRelativePath(value), {
        message: "Use um caminho relativo dentro do repositório",
      }),
    // Blank means automatic: each build reads it from the Dockerfile's EXPOSE.
    internalPort: z.union([
      z
        .literal("")
        .or(z.null())
        .transform(() => null),
      z.coerce
        .number()
        .int("Informe um número inteiro")
        .min(1, "A porta deve ser maior que 0")
        .max(MAX_PORT, `A porta deve ser no máximo ${MAX_PORT}`),
    ]),
    healthCheckPath: healthCheckPathSchema,
    autoDeploy: z.boolean(),
    autoApplyChanges: z.boolean(),
    /** Rolls back on its own a new version whose containers keep restarting; on when absent. */
    autoRollback: z.boolean().default(true),
    previewsEnabled: z.boolean(),
    // Blank means no limit, as Docker runs containers by default.
    memoryLimitInMb: optionalLimit({
      min: MIN_MEMORY_LIMIT_IN_MB,
      max: MAX_MEMORY_LIMIT_IN_MB,
      rangeMessage: "Use pelo menos 64 MB",
    }),
    cpuLimitInMillicores: optionalLimit({
      min: MIN_CPU_LIMIT_IN_MILLICORES,
      max: MAX_CPU_LIMIT_IN_MILLICORES,
      rangeMessage: "Limite de CPU inválido",
    }),
    /** Containers of each deployment the proxy balances requests between; one when absent. */
    replicas: z.coerce
      .number()
      .int("Informe um número inteiro")
      .min(1, `Use de 1 a ${MAX_REPLICAS} réplicas`)
      .max(MAX_REPLICAS, `Use de 1 a ${MAX_REPLICAS} réplicas`)
      .default(1),
    /** Compose file of a project built with Docker Compose, relative to the repository. */
    composeFilePath: relativePathSchema.default(DEFAULT_COMPOSE_FILE),
    /** Compose service that receives the project's domains; only for Docker Compose. */
    composeService: z
      .string()
      .trim()
      .max(MAX_COMPOSE_SERVICE_LENGTH)
      .refine((value) => value === "" || COMPOSE_SERVICE_PATTERN.test(value), {
        message: "Use letras minúsculas, números, ., _ e -",
      })
      .or(z.null())
      .transform((value) => (value == null || value === "" ? null : value))
      .default(null),
  })
  .superRefine((project, context) => {
    if (project.builder !== "compose") {
      return;
    }
    // Compose recreates the services in place under one project name, so there is a single
    // copy of each service and no per-pull-request stack.
    const rules = [
      [
        project.composeService == null,
        "composeService",
        "Informe o serviço que recebe os domínios",
      ],
      [
        project.internalPort == null,
        "internalPort",
        "Informe a porta do serviço que recebe os domínios",
      ],
      [project.replicas !== 1, "replicas", "Projetos Docker Compose usam 1 réplica"],
      [
        project.previewsEnabled,
        "previewsEnabled",
        "Projetos Docker Compose não têm previews de pull request",
      ],
    ] as const;
    for (const [broken, path, message] of rules) {
      if (broken) {
        context.addIssue({ code: "custom", path: [path], message });
      }
    }
  });

export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Optional read credential for a private repository. Never returned to clients. */
export const repositoryTokenSchema = z
  .string()
  .trim()
  .max(MAX_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9_.-]*$/, "Token com caracteres inválidos");
