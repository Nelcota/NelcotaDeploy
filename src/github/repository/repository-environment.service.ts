import { parseDotenv } from "@/shared/dotenv";
import {
  MAX_IMPORT_ENTRIES,
  suggestedVariableKind,
} from "@/shared/schemas/environment/environment-import.schema";
import { isSafeRelativePath, isValidBranchName } from "@/shared/schemas/project.schema";

import { GITHUB_API } from "../github-api";
import { GitHubApiError } from "../github.errors";
import { preferredProjectFile, readRepositoryText } from "./repository-files";
import {
  type InspectionDependencies,
  type InspectionRequest,
  repositoryCredential,
} from "./repository-inspection.service";
import { readRepositoryTree } from "./repository-metadata";

/**
 * Reads a regular `.env.example` blob from the selected branch without evaluating its content.
 *
 * @param dependencies - Database, encryption and optional test API.
 * @param request - Repository, branch and project build paths; optional chosen example path.
 * @returns Available files and parsed defaults with credential examples removed.
 * @throws {GitHubApiError} When metadata, encoding or template limits are invalid.
 * @throws {RangeError} When the branch or selected path is invalid.
 */
export async function readRepositoryEnvironmentExample(
  dependencies: InspectionDependencies,
  request: InspectionRequest & {
    readonly branch: string;
    readonly buildContext: string;
    readonly dockerfilePath: string;
    readonly path?: string | undefined;
  },
) {
  if (
    isValidBranchName(request.branch) === false ||
    (request.path != null &&
      (isSafeRelativePath(request.path) === false ||
        /(?:^|\/)\.env\.example$/.test(request.path) === false))
  ) {
    throw new RangeError("Invalid environment example branch or path");
  }
  const api = dependencies.api ?? GITHUB_API;
  const credential = await repositoryCredential(dependencies, request);
  const tree = await readRepositoryTree(api, credential, request.branch);
  const paths = tree.environmentExamples.map((entry) => entry.path).toSorted();
  const path =
    request.path ??
    preferredProjectFile({
      paths,
      buildContext: request.buildContext,
      dockerfilePath: request.dockerfilePath,
      fileName: ".env.example",
    });
  const result = { paths, pathsLimited: tree.pathsLimited, branch: request.branch };
  if (path == null) {
    return { ...result, source: null, entries: [], problems: [] };
  }
  const entry = tree.environmentExamples.find((candidate) => candidate.path === path);
  if (entry?.sha == null) {
    throw new GitHubApiError(
      "Environment example is missing, unsafe or exceeds the size limit",
      null,
    );
  }
  const parsed = parseDotenv(await readRepositoryText(api, { credential, file: entry }));
  if (parsed.entries.length > MAX_IMPORT_ENTRIES) {
    throw new GitHubApiError("Environment example exceeds the variable limit", null);
  }
  const entries = parsed.entries.map(({ key, value }) => {
    const kind = suggestedVariableKind(key, value);
    return { key, kind, value: kind === "secret" ? "" : value };
  });
  return {
    ...result,
    source: { path, sha: entry.sha },
    entries,
    problems: parsed.problems.map(({ line }) => ({ line })),
  };
}
