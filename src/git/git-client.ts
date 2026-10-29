import { type CommandRunner, type OutputStream, type ProcessResult, runProcess } from "@/process";

import { GitCommandError } from "./git.errors";

const CLONE_DEPTH = 50;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,40}$/;
/** Credentials go in this variable for the credential helper, never in arguments or URLs. */
const PASSWORD_VARIABLE = "NELCOTA_GIT_PASSWORD";
/**
 * Inline credential helper: git runs it through a shell and it prints the token from the
 * environment. Nothing is written to disk, which matters on servers reached over SSH.
 */
const CREDENTIAL_HELPER = `!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$${PASSWORD_VARIABLE}"; }; f`;

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
 * history, it is fetched directly. Tokens reach git only through an environment variable
 * read by a credential helper.
 */
export class GitClient {
  readonly #binary: string;
  readonly #runner: CommandRunner;

  /**
   * @param binary - Git executable on the host the runner reaches.
   * @param runner - Where commands run; this host by default.
   */
  constructor(binary: string, runner: CommandRunner = runProcess) {
    this.#binary = binary;
    this.#runner = runner;
  }

  /**
   * Checks out the requested revision into a fresh shallow clone.
   *
   * @param options - Repository, revision, target directory and credentials.
   * @returns The commit now checked out.
   * @throws {GitCommandError} When cloning or checkout fails, or the SHA is malformed.
   */
  async checkoutRevision(options: CloneOptions): Promise<CheckedOutCommit> {
    if (options.commitSha != null && isCommitSha(options.commitSha) === false) {
      throw new GitCommandError(`Invalid commit SHA: ${JSON.stringify(options.commitSha)}`);
    }
    const environment = gitEnvironment(options.token);
    const credentials = credentialArgs(options.token);
    const run = async (args: string[], cwd?: string): Promise<ProcessResult> =>
      await this.#runner([this.#binary, ...credentials, ...args], {
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
}

function hasToken(token: string | null): token is string {
  return token != null && token.trim() !== "";
}

/**
 * Builds the environment of every git command: no prompts, no system config, no LFS
 * downloads, and the token when the repository is private.
 *
 * @param token - Read token, or null for a public repository.
 * @returns Variables for the git process.
 */
export function gitEnvironment(token: string | null): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
  if (hasToken(token) === false) {
    return environment;
  }
  return { ...environment, [PASSWORD_VARIABLE]: token };
}

/**
 * Builds the `-c` options that make git ask the inline credential helper, and only it.
 *
 * @param token - Read token, or null for a public repository.
 * @returns Options placed before the git subcommand; none without a token.
 */
export function credentialArgs(token: string | null): string[] {
  if (hasToken(token) === false) {
    return [];
  }
  // The empty value clears helpers from the user's config, so the token goes nowhere else.
  return ["-c", "credential.helper=", "-c", `credential.helper=${CREDENTIAL_HELPER}`];
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
