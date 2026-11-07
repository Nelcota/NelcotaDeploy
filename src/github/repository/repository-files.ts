import { z } from "zod";

import { type GitHubApi, githubRequest } from "../github-api";
import { GitHubApiError } from "../github.errors";
import type { RepositoryRequest } from "./repository-metadata";

const MAX_FILE_BYTES = 65_536;
const MAX_ENCODED_LENGTH = 100_000;
const blobSchema = z.object({
  sha: z.string(),
  encoding: z.literal("base64"),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  content: z.string().max(MAX_ENCODED_LENGTH),
});

export type RepositoryFile = {
  readonly path: string;
  readonly sha: string | null;
  readonly size: number | null;
};

export function preferredProjectFile(input: {
  readonly paths: readonly string[];
  readonly buildContext: string;
  readonly dockerfilePath: string;
  readonly fileName: string;
}): string | null {
  const directory = input.dockerfilePath.includes("/")
    ? input.dockerfilePath.slice(0, input.dockerfilePath.lastIndexOf("/"))
    : ".";
  const candidates = [
    input.buildContext === "." ? input.fileName : `${input.buildContext}/${input.fileName}`,
    directory === "." ? input.fileName : `${directory}/${input.fileName}`,
    input.fileName,
  ];
  return (
    candidates.find((path) => input.paths.includes(path)) ??
    (input.paths.length === 1 ? (input.paths.at(0) ?? null) : null)
  );
}

/** Reads immutable regular-file blobs; no repository content is executed or followed as a symlink. */
export async function readRepositoryText(
  api: GitHubApi,
  input: { readonly credential: RepositoryRequest; readonly file: RepositoryFile },
): Promise<string> {
  const { file, credential } = input;
  if (file.sha == null || (file.size != null && file.size > MAX_FILE_BYTES)) {
    throw new GitHubApiError("Repository file is unsafe or exceeds the size limit", null);
  }
  const answer = await githubRequest(api, {
    path: `/repos/${credential.fullName}/git/blobs/${file.sha}`,
    ...(credential.bearer == null ? {} : { bearer: credential.bearer }),
  });
  const parsed = blobSchema.safeParse(answer);
  if (parsed.success === false || parsed.data.sha !== file.sha) {
    throw new GitHubApiError("GitHub returned invalid repository file content", null);
  }
  const encoded = parsed.data.content.replaceAll(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength > MAX_FILE_BYTES ||
    bytes.byteLength !== parsed.data.size ||
    bytes.toString("base64") !== encoded
  ) {
    throw new GitHubApiError("GitHub returned invalid repository file encoding", null);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubApiError("Repository file is not valid UTF-8", null);
  }
}
