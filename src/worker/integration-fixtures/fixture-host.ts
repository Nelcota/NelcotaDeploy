import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "@/process";

const HOST_COMMAND_TIMEOUT_IN_MS = 30_000;

/** Undoes something the integration test created on the host. */
export type Cleanup = () => Promise<void>;

async function git(args: readonly string[], cwd: string): Promise<void> {
  const result = await runProcess(["git", ...args], {
    cwd,
    timeoutInMs: HOST_COMMAND_TIMEOUT_IN_MS,
    env: {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * Creates an empty temporary directory and registers its removal.
 *
 * @param prefix - Directory name prefix.
 * @param cleanups - Receives the removal.
 * @returns The directory path.
 */
export async function createTemporaryDirectory(
  prefix: string,
  cleanups: Cleanup[],
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * Copies the fixture app into a fresh git repository with one commit.
 *
 * @param fixtureDirectory - Source of the fixture app.
 * @param cleanups - Receives the removal of the repository.
 * @returns The repository path.
 */
export async function createFixtureRepository(
  fixtureDirectory: string,
  cleanups: Cleanup[],
): Promise<string> {
  const repository = await createTemporaryDirectory("nelcota-fixture-", cleanups);
  await cp(fixtureDirectory, repository, { recursive: true });
  await git(["init", "--initial-branch", "main"], repository);
  await git(["add", "."], repository);
  await git(["commit", "--message", "feat: fixture app"], repository);
  return repository;
}

/**
 * Removes a Docker network created for the test.
 *
 * @param network - Network name.
 */
export async function removeDockerNetwork(network: string): Promise<void> {
  await runProcess(["docker", "network", "rm", network], {
    timeoutInMs: HOST_COMMAND_TIMEOUT_IN_MS,
  });
}

/**
 * Runs cleanups newest first, one at a time, since later resources depend on earlier ones.
 *
 * @param cleanups - Cleanups in the order they were registered.
 */
export async function runCleanupsInReverse(cleanups: readonly Cleanup[]): Promise<void> {
  const latest = cleanups.at(-1);
  if (latest == null) {
    return;
  }
  await latest();
  await runCleanupsInReverse(cleanups.slice(0, -1));
}
