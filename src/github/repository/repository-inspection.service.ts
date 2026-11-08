import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";
import { isValidBranchName, parseGitHubRepository } from "@/shared/schemas/project.schema";

import { repositoryAccessToken } from "../github-access.service";
import { GITHUB_API, type GitHubApi } from "../github-api";
import { readGitHubAppCredentials } from "../github-app.service";
import {
  readRepositoryBranches,
  readRepositoryDetails,
  readRepositoryTree,
} from "./repository-metadata";

export type InspectionRequest = {
  readonly repositoryUrl: string;
  readonly branch?: string | undefined;
  readonly token?: string | null;
};

export type InspectionDependencies = {
  readonly database: Database;
  readonly secretBox: SecretBox;
  readonly api?: GitHubApi;
};

export async function repositoryCredential(
  { database, secretBox, api = GITHUB_API }: InspectionDependencies,
  request: InspectionRequest,
) {
  const repository = parseGitHubRepository(request.repositoryUrl);
  if (repository == null) {
    throw new RangeError("Repository inspection requires a valid GitHub HTTPS URL");
  }
  if (request.token != null && request.token.trim() !== "") {
    return { fullName: repository.fullName, bearer: request.token, access: "token" as const };
  }
  const app = await readGitHubAppCredentials(database, secretBox);
  const token = app == null ? null : await repositoryAccessToken(api, app, repository.fullName);
  return {
    fullName: repository.fullName,
    bearer: token ?? undefined,
    access: token == null ? ("public" as const) : ("github-app" as const),
  };
}

/**
 * Checks how a repository is accessed without returning any credential.
 *
 * @param dependencies - Database, encryption box and optional GitHub API endpoint for tests.
 * @param request - Repository and optional saved read token.
 * @returns Access method, visibility and default branch.
 * @throws {GitHubApiError} When the repository cannot be read.
 * @throws {RangeError} When the repository URL is invalid.
 */
export async function getRepositoryAccess(
  dependencies: InspectionDependencies,
  request: InspectionRequest,
) {
  const api = dependencies.api ?? GITHUB_API;
  const credential = await repositoryCredential(dependencies, request);
  const details = await readRepositoryDetails(api, credential);
  return {
    fullName: credential.fullName,
    access: credential.access,
    isPrivate: details.private,
    defaultBranch: details.default_branch,
  };
}

/**
 * Discovers a repository's branches, Dockerfiles and directories without executing its code.
 *
 * @param dependencies - Database, encryption box and optional GitHub API endpoint for tests.
 * @param request - Repository, optional branch and saved read token.
 * @returns Validated metadata and whether any listing was limited.
 * @throws {GitHubApiError} When GitHub fails or returns invalid metadata.
 * @throws {RangeError} When the repository URL or branch is invalid.
 */
export async function inspectRepository(
  dependencies: InspectionDependencies,
  request: InspectionRequest,
) {
  if (request.branch != null && isValidBranchName(request.branch) === false) {
    throw new RangeError("Repository inspection requires a valid branch name");
  }
  const api = dependencies.api ?? GITHUB_API;
  const credential = await repositoryCredential(dependencies, request);
  const details = await readRepositoryDetails(api, credential);
  const branch = request.branch ?? details.default_branch;
  const [branches, paths] = await Promise.all([
    readRepositoryBranches(api, credential),
    readRepositoryTree(api, credential, branch),
  ]);
  return {
    fullName: credential.fullName,
    access: credential.access,
    isPrivate: details.private,
    defaultBranch: details.default_branch,
    branch,
    ...branches,
    dockerfiles: paths.dockerfiles,
    directories: paths.directories,
    pathsLimited: paths.pathsLimited,
  };
}
