import { expect, test } from "bun:test";

import { type CommandRunner, type ProcessResult, runProcess } from "@/process";

import { DockerCli } from "./docker-cli";
import { DockerCommandError, InvalidDockerArgumentError } from "./docker.errors";

const SUCCESS: ProcessResult = {
  exitCode: 0,
  stdout: "Total: 0B\n",
  stderr: "",
  timedOut: false,
  aborted: false,
};

test("validates both cache limits before running any prune command", async () => {
  const calls: string[] = [];
  const runner: CommandRunner = async (command) => {
    calls.push(command.join(" "));
    return await Promise.resolve(SUCCESS);
  };
  const docker = new DockerCli("docker", runner);

  const error = await docker
    .pruneBuildCache({ retentionInHours: 168, maxUsedSpaceInGb: 0 })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(InvalidDockerArgumentError);
  expect(calls).toHaveLength(0);
});

test("counts cache reclaimed space after captured output is truncated", async () => {
  const runner: CommandRunner = async (_command, options) =>
    await runProcess(
      [
        process.execPath,
        "-e",
        'console.log("cache-record".repeat(100_000)); console.log("Total:\\t1.5GB");',
      ],
      options,
    );
  const docker = new DockerCli("docker", runner);

  const freedBytes = await docker.pruneBuildCache({ retentionInHours: 168, maxUsedSpaceInGb: 10 });

  expect(freedBytes).toBe(3_000_000_000);
});

test("counts image reclaimed space after captured output is truncated", async () => {
  const runner: CommandRunner = async (_command, options) =>
    await runProcess(
      [
        process.execPath,
        "-e",
        'console.log("deleted-image".repeat(100_000)); console.log("Total reclaimed space: 512MB");',
      ],
      options,
    );
  const docker = new DockerCli("docker", runner);

  const freedBytes = await docker.pruneDanglingImages();

  expect(freedBytes).toBe(512_000_000);
});

test("reports a failed prune instead of recording its partial output as success", async () => {
  const runner: CommandRunner = async (_command, options) => {
    options.onLine?.("Total: 1GB", "stdout");
    return await Promise.resolve({ ...SUCCESS, exitCode: 1, stderr: "daemon disconnected" });
  };
  const docker = new DockerCli("docker", runner);

  const error = await docker.pruneDanglingImages().catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DockerCommandError);
});

test("reads a captured total when the runner supplies no streamed output", async () => {
  const runner: CommandRunner = async () =>
    await Promise.resolve({ ...SUCCESS, stdout: "Total reclaimed space: 32MB\n" });
  const docker = new DockerCli("docker", runner);

  expect(await docker.pruneDanglingImages()).toBe(32_000_000);
});
