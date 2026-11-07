import { z } from "zod";

import { isSafeRelativePath, isValidBranchName } from "@/shared/schemas/project.schema";

import { type GitHubApi, githubPages, githubRequest } from "../github-api";
import { GitHubApiError } from "../github.errors";
import type { RepositoryFile } from "./repository-files";

const PAGE_SIZE = 100;
const MAX_BRANCH_PAGES = 5;
const MAX_TREE_ENTRIES = 100_000;
const MAX_RETURNED_PATHS = 500;
const MAX_RECEIVED_PATH_LENGTH = 4096;
const HTTP_EMPTY_REPOSITORY = 409;
const branchNameSchema = z.string().refine(isValidBranchName);
const detailsSchema = z.object({ default_branch: branchNameSchema, private: z.boolean() });
const branchesSchema = z
  .array(z.object({ name: z.string().max(MAX_RECEIVED_PATH_LENGTH) }))
  .max(PAGE_SIZE);
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string().max(MAX_RECEIVED_PATH_LENGTH),
        type: z.enum(["blob", "tree", "commit"]),
        mode: z.string(),
        sha: z
          .string()
          .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
          .optional(),
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .max(MAX_TREE_ENTRIES),
});

export type RepositoryRequest = {
  readonly fullName: string;
  readonly bearer?: string | undefined;
};

function parseAnswer<T>(schema: z.ZodType<T>, answer: unknown): T {
  const parsed = schema.safeParse(answer);
  if (parsed.success === false) {
    throw new GitHubApiError("GitHub returned invalid repository metadata", null);
  }
  return parsed.data;
}

export async function readRepositoryDetails(api: GitHubApi, request: RepositoryRequest) {
  const answer = await githubRequest(api, {
    path: `/repos/${request.fullName}`,
    ...(request.bearer == null ? {} : { bearer: request.bearer }),
  });
  return parseAnswer(detailsSchema, answer);
}

/** Uses SDK pagination while keeping branch discovery bounded to five pages. */
export async function readRepositoryBranches(
  api: GitHubApi,
  request: RepositoryRequest,
): Promise<{ branches: string[]; branchesLimited: boolean }> {
  const branches: string[] = [];
  let pageCount = 0;
  for await (const page of githubPages(
    api,
    `/repos/${request.fullName}/branches?per_page=${PAGE_SIZE}`,
    request.bearer,
  )) {
    const rows = parseAnswer(branchesSchema, page.data);
    branches.push(...rows.map((row) => row.name).filter(isValidBranchName));
    pageCount += 1;
    if (pageCount >= MAX_BRANCH_PAGES) {
      return { branches, branchesLimited: rows.length === PAGE_SIZE };
    }
  }
  return { branches, branchesLimited: false };
}

/** Lists regular Dockerfiles and directories; symlinks and unsafe paths are never suggestions. */
export async function readRepositoryTree(
  api: GitHubApi,
  request: RepositoryRequest,
  branch: string,
) {
  const answer = await githubRequest(api, {
    path: `/repos/${request.fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    ...(request.bearer == null ? {} : { bearer: request.bearer }),
  }).catch((error: unknown) => {
    if (error instanceof GitHubApiError && error.status === HTTP_EMPTY_REPOSITORY) {
      return { tree: [], truncated: false };
    }
    throw error;
  });
  const tree = parseAnswer(treeSchema, answer);
  const safe = tree.tree.filter((entry) => isSafeRelativePath(entry.path));
  const regularFiles: RepositoryFile[] = safe
    .filter((entry) => entry.type === "blob" && entry.mode !== "120000")
    .map((entry) => ({ path: entry.path, sha: entry.sha ?? null, size: entry.size ?? null }));
  const dockerfiles = safe
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.mode !== "120000" &&
        /(?:^|\/)(?:Dockerfile(?:[.-][A-Za-z0-9._-]+)?|[A-Za-z0-9._-]+\.Dockerfile)$/.test(
          entry.path,
        ),
    )
    .map((entry) => entry.path)
    .toSorted();
  const directories = safe
    .filter((entry) => entry.type === "tree")
    .map((entry) => entry.path)
    .toSorted();
  const environmentExamples = safe
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.mode !== "120000" &&
        /(?:^|\/)\.env\.example$/.test(entry.path),
    )
    .map((entry) => ({ path: entry.path, sha: entry.sha ?? null, size: entry.size ?? null }));
  return {
    regularFiles,
    environmentExamples: environmentExamples.slice(0, MAX_RETURNED_PATHS),
    dockerfiles: dockerfiles.slice(0, MAX_RETURNED_PATHS),
    directories: [".", ...directories.slice(0, MAX_RETURNED_PATHS)],
    pathsLimited:
      tree.truncated ||
      environmentExamples.length > MAX_RETURNED_PATHS ||
      dockerfiles.length > MAX_RETURNED_PATHS ||
      directories.length > MAX_RETURNED_PATHS,
  };
}
