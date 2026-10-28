import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type OutputStream, type ProcessResult, runProcess } from "@/process";

import { GitCommandError } from "./git.errors";

const CLONE_DEPTH = 50;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,40}$/;
const ASKPASS_FILE_MODE = 0o700;
/** Credentials go in this variable for the askpass helper, never in arguments or URLs. */
const PASSWORD_VARIABLE = "NELCOTA_GIT_PASSWORD";
const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' "x-access-token" ;;
  *) printf '%s\\n' "$${PASSWORD_VARIABLE}" ;;
esac
`;

/** Commit checked out in a workspace. */
export type CheckedOutCommit = { readonly sha: string; readonly message: string };

export type CloneOptions = {
  /** Credential-free HTTPS clone URL. */
  readonly cloneUrl: string;
  readonly branch: string;
  /** Exact commit to check out; the branch head is used when null. */
  readonly commitSha: string | null;
  /** Empty directory to clone into. */
  readonly directory: string;
  /** Directory for the askpass helper, outside the cloned tree. */
  readonly scratchDirectory: string;
  /** Read token for private repositories. */
  readonly token: string | null;
  readonly timeoutInMs: number;
  readonly signal?: AbortSignal;
  readonly onLine?: (line: string, stream: OutputStream) => void;
};

/**
 * Tells whether a value looks like a git commit SHA.
 *
 * @param value - Candidate SHA.
 * @returns True for 7–40 lowercase hex characters.
 */
export function isCommitSha(value: string): boolean {
  return COMMIT_SHA_PATTERN.test(value);
}

/**
 * Clones a repository and checks out a branch or exact commit.
 *
 * @remarks
 * Uses a shallow single-branch clone. When the requested commit is older than the shallow
 * history, it is fetched directly. Tokens reach git only through `GIT_ASKPASS`.
 */
export class GitClient {
  readonly #binary: string;

  constructor(binary: string) {
    this.#binary = binary;
  }

  /**
   * Clones and checks out the requested revision.
   *
   * @param options - Repository, revision, target directory and credentials.
   * @returns The commit now checked out.
   * @throws {GitCommandError} When cloning or checkout fails, or the SHA is malformed.
   */
  async cloneAndCheckout(options: CloneOptions): Promise<CheckedOutCommit> {
    if (options.commitSha != null && isCommitSha(options.commitSha) === false) {
      throw new GitCommandError(`Invalid commit SHA: ${JSON.stringify(options.commitSha)}`);
    }
    const environment = await this.#environment(options);
    const run = async (args: string[], cwd?: string): Promise<ProcessResult> =>
      await runProcess([this.#binary, ...args], {
        env: environment,
        timeoutInMs: options.timeoutInMs,
        ...(cwd == null ? {} : { cwd }),
        ...(options.signal == null ? {} : { signal: options.signal }),
        ...(options.onLine == null ? {} : { onLine: options.onLine }),
      });

    const clone = await run([
      "clone",
      "--depth",
      String(CLONE_DEPTH),
      "--branch",
      options.branch,
      "--single-branch",
      "--no-tags",
      "--",
      options.cloneUrl,
      options.directory,
    ]);
    assertSucceeded(clone, "clone");

    if (options.commitSha != null) {
      await this.#checkoutCommit(options.commitSha, options.directory, run);
    }
    const log = await run(["log", "-1", "--format=%H%n%s"], options.directory);
    assertSucceeded(log, "log");
    const [sha = "", message = ""] = log.stdout.split("\n");
    return { sha: sha.trim(), message: message.trim() };
  }

  async #checkoutCommit(
    commitSha: string,
    directory: string,
    run: (args: string[], cwd?: string) => Promise<ProcessResult>,
  ): Promise<void> {
    const checkout = await run(["checkout", "--detach", commitSha], directory);
    if (checkout.exitCode === 0) {
      return;
    }
    const fetch = await run(["fetch", "--depth", "1", "origin", commitSha], directory);
    assertSucceeded(fetch, "fetch");
    assertSucceeded(await run(["checkout", "--detach", "FETCH_HEAD"], directory), "checkout");
  }

  async #environment(options: CloneOptions): Promise<Record<string, string>> {
    const environment: Record<string, string> = {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_LFS_SKIP_SMUDGE: "1",
    };
    if (options.token == null || options.token === "") {
      return environment;
    }
    const askpassPath = join(options.scratchDirectory, "git-askpass.sh");
    await writeFile(askpassPath, ASKPASS_SCRIPT);
    await chmod(askpassPath, ASKPASS_FILE_MODE);
    return { ...environment, GIT_ASKPASS: askpassPath, [PASSWORD_VARIABLE]: options.token };
  }
}

function assertSucceeded(result: ProcessResult, step: string): void {
  if (result.exitCode === 0) {
    return;
  }
  if (result.timedOut) {
    throw new GitCommandError(`git ${step} timed out`);
  }
  if (result.aborted) {
    throw new GitCommandError(`git ${step} was cancelled`);
  }
  const lastLine = result.stderr.trim().split("\n").at(-1) ?? "";
  throw new GitCommandError(`git ${step} failed: ${lastLine}`);
}
