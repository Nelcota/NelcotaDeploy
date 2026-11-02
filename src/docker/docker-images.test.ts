import { describe, expect, test } from "bun:test";

import type { CommandRunner, ProcessResult } from "@/process";

import { DockerImages } from "./docker-images";
import { DockerCommandError, InvalidDockerArgumentError } from "./docker.errors";

function reply(exitCode: number): ProcessResult {
  return {
    exitCode,
    stdout: "",
    stderr: exitCode === 0 ? "" : "Error: boom",
    timedOut: false,
    aborted: false,
  };
}

/** Answers `image inspect` as the host would and records every command with its timeout. */
function fakeImages(present: boolean, pullExitCode = 0) {
  const commands: { readonly args: string; readonly timeoutInMs: number | undefined }[] = [];
  const runner: CommandRunner = async (command, options) => {
    commands.push({ args: command.slice(1).join(" "), timeoutInMs: options.timeoutInMs });
    if (command[2] === "inspect") {
      return await Promise.resolve(reply(present ? 0 : 1));
    }
    return await Promise.resolve(reply(pullExitCode));
  };
  return { images: new DockerImages("docker", runner), commands };
}

describe("DockerImages.ensurePulled", () => {
  test("does not download an image the host already has", async () => {
    const { images, commands } = fakeImages(true);

    await images.ensurePulled("postgres:18.6-alpine");

    expect(commands.map((command) => command.args)).toEqual([
      "image inspect --format {{.Id}} postgres:18.6-alpine",
    ]);
  });

  test("downloads a missing image with a long timeout", async () => {
    const { images, commands } = fakeImages(false);

    await images.ensurePulled("postgres:18.6-alpine");

    expect(commands.at(-1)).toEqual({
      args: "image pull -- postgres:18.6-alpine",
      timeoutInMs: 600_000,
    });
  });

  test("throws DockerCommandError when the download fails", async () => {
    const { images } = fakeImages(false, 1);

    const error = await images
      .ensurePulled("postgres:18.6-alpine")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DockerCommandError);
  });

  test("throws InvalidDockerArgumentError for a reference that could be read as an option", async () => {
    const { images } = fakeImages(false);

    const error = await images.ensurePulled("--all:latest").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidDockerArgumentError);
  });
});
