import { z } from "zod";

const MAX_NAME_LENGTH = 64;
const MAX_SLUG_LENGTH = 40;
const MAX_RELATIVE_PATH_LENGTH = 200;
const MAX_BRANCH_LENGTH = 200;
const MAX_PORT = 65_535;
const MAX_TOKEN_LENGTH = 512;

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

/** Fields accepted when creating or editing a project. */
export const projectInputSchema = z.object({
  name: trimmedText(MAX_NAME_LENGTH),
  slug: projectSlugSchema,
  repositoryUrl: repositoryUrlSchema,
  branch: z.string().trim().refine(isValidBranchName, { message: "Nome de branch inválido" }),
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
  previewsEnabled: z.boolean(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Optional read credential for a private repository. Never returned to clients. */
export const repositoryTokenSchema = z
  .string()
  .trim()
  .max(MAX_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9_.-]*$/, "Token com caracteres inválidos");
