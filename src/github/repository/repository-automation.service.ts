import { z } from "zod";

import { formatCommandLine } from "@/shared/command-line";
import { isSafeRelativePath, isValidBranchName } from "@/shared/schemas/project.schema";

import { GITHUB_API } from "../github-api";
import { GitHubApiError } from "../github.errors";
import { parseDockerfileHints } from "./dockerfile-hints";
import { preferredProjectFile, readRepositoryText } from "./repository-files";
import {
  type InspectionDependencies,
  type InspectionRequest,
  repositoryCredential,
} from "./repository-inspection.service";
import { readRepositoryTree } from "./repository-metadata";

const MAX_PACKAGE_PATHS = 500;
const MAX_SCRIPTS = 100;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
const packageSchema = z.object({
  scripts: z.record(z.string().max(256), z.string().max(32_768)).optional(),
});
type ProjectRequest = InspectionRequest & {
  readonly branch: string;
  readonly buildContext: string;
  readonly dockerfilePath: string;
};

async function projectFiles(dependencies: InspectionDependencies, request: ProjectRequest) {
  if (
    isValidBranchName(request.branch) === false ||
    isSafeRelativePath(request.buildContext) === false ||
    isSafeRelativePath(request.dockerfilePath) === false
  ) {
    throw new RangeError("Invalid repository automation branch or build paths");
  }
  const api = dependencies.api ?? GITHUB_API;
  const credential = await repositoryCredential(dependencies, request);
  const tree = await readRepositoryTree(api, credential, request.branch);
  return { api, credential, ...tree };
}

function packageScripts(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new GitHubApiError("Repository package manifest is not valid JSON", null);
  }
  const parsed = packageSchema.safeParse(value);
  if (parsed.success === false) {
    throw new GitHubApiError("Repository package manifest has invalid scripts", null);
  }
  const entries = Object.entries(parsed.data.scripts ?? {});
  const safe = entries.filter(([name, command]) => SCRIPT_NAME.test(name) && command.trim() !== "");
  return {
    scripts: safe
      .slice(0, MAX_SCRIPTS)
      .map(([name]) => ({ name, commandLine: formatCommandLine(["bun", "run", name]) })),
    limited: safe.length !== entries.length || safe.length > MAX_SCRIPTS,
  };
}

/**
 * Discovers package scripts without evaluating their bodies or returning embedded credentials.
 *
 * @param dependencies - Repository access and optional test API.
 * @param request - Saved project build paths and optional selected package manifest.
 * @returns Script commands, their immutable source and whether Bun was found in the final base image.
 * @throws {GitHubApiError} When GitHub or manifest content is invalid.
 * @throws {RangeError} When the branch or a requested path is invalid.
 */
export async function readRepositoryTaskScripts(
  dependencies: InspectionDependencies,
  request: ProjectRequest & { readonly packagePath?: string | undefined },
) {
  if (
    request.packagePath != null &&
    (isSafeRelativePath(request.packagePath) === false ||
      /(?:^|\/)package\.json$/.test(request.packagePath) === false)
  ) {
    throw new RangeError("Invalid package manifest path");
  }
  const files = await projectFiles(dependencies, request);
  const all = files.regularFiles.filter((file) => /(?:^|\/)package\.json$/.test(file.path));
  const paths = all
    .map((file) => file.path)
    .toSorted()
    .slice(0, MAX_PACKAGE_PATHS);
  const selected =
    request.packagePath ??
    preferredProjectFile({
      paths,
      buildContext: request.buildContext,
      dockerfilePath: request.dockerfilePath,
      fileName: "package.json",
    });
  const result = {
    paths,
    branch: request.branch,
    pathsLimited: files.pathsLimited || all.length > MAX_PACKAGE_PATHS,
  };
  if (selected == null) {
    return { ...result, source: null, scripts: [], bunDetected: false, limited: false };
  }
  const manifest = all.find((file) => file.path === selected);
  if (manifest == null) {
    throw new GitHubApiError("Selected package manifest is missing or unsafe", null);
  }
  const dockerfile = files.regularFiles.find((file) => file.path === request.dockerfilePath);
  const [text, dockerfileText] = await Promise.all([
    readRepositoryText(files.api, { credential: files.credential, file: manifest }),
    dockerfile == null
      ? null
      : readRepositoryText(files.api, { credential: files.credential, file: dockerfile }),
  ]);
  return {
    ...result,
    source: { path: manifest.path, sha: manifest.sha },
    ...packageScripts(text),
    bunDetected: dockerfileText != null && parseDockerfileHints(dockerfileText).bun,
  };
}

/**
 * Reads safe volume declarations from the project's selected Dockerfile.
 *
 * @param dependencies - Repository access and optional test API.
 * @param request - Saved project branch and build paths.
 * @returns Literal mount paths and their immutable source, with unsupported syntax explicitly flagged.
 * @throws {GitHubApiError} When GitHub or blob content is invalid.
 * @throws {RangeError} When the branch or build paths are invalid.
 */
export async function readRepositoryVolumeHints(
  dependencies: InspectionDependencies,
  request: ProjectRequest,
) {
  const files = await projectFiles(dependencies, request);
  const file = files.regularFiles.find((candidate) => candidate.path === request.dockerfilePath);
  if (file == null) {
    return { branch: request.branch, source: null, paths: [], limited: files.pathsLimited };
  }
  const text = await readRepositoryText(files.api, { credential: files.credential, file });
  const hints = parseDockerfileHints(text);
  return {
    branch: request.branch,
    source: { path: file.path, sha: file.sha },
    paths: hints.volumes,
    limited: hints.limited || files.pathsLimited,
  };
}

/**
 * Detects a local HTTP health path in the selected Dockerfile without executing its probe.
 *
 * @param dependencies - Repository access and optional test API.
 * @param request - Repository, branch and drafted or saved build paths.
 * @returns The source and a literal HTTP path, or null when detection is unsafe.
 * @throws {GitHubApiError} When GitHub or file content is invalid.
 * @throws {RangeError} When the branch or paths are invalid.
 */
export async function readRepositoryHealthCheck(
  dependencies: InspectionDependencies,
  request: ProjectRequest,
) {
  const files = await projectFiles(dependencies, request);
  const file = files.regularFiles.find((candidate) => candidate.path === request.dockerfilePath);
  const repository = {
    fullName: files.credential.fullName,
    branch: request.branch,
    dockerfilePath: request.dockerfilePath,
  };
  if (file == null) {
    return { ...repository, path: null, source: null };
  }
  const hints = parseDockerfileHints(
    await readRepositoryText(files.api, { credential: files.credential, file }),
  );
  return {
    ...repository,
    path: hints.limited ? null : (hints.healthCheckPath ?? null),
    source: { path: file.path, sha: file.sha },
  };
}
