import { expect, test } from "bun:test";

import type { CommandRunner } from "@/process";

import { DockerCli } from "./docker-cli";
import { InvalidDockerArgumentError } from "./docker.errors";

test.each(["PATH", "HOME", "LD_PRELOAD"])(
  "rejects hidden process variables before launching Docker: %s",
  async (key) => {
    let calls = 0;
    const runner: CommandRunner = () => {
      calls += 1;
      return Promise.resolve({
        exitCode: 0,
        stdout: "container",
        stderr: "",
        timedOut: false,
        aborted: false,
      });
    };
    const docker = new DockerCli("docker", runner);
    const values = { [key]: "untrusted" };
    const buildFailure = await docker
      .buildImage(
        {
          dockerfilePath: "Dockerfile",
          contextPath: ".",
          imageTag: "nelcota/api:abc",
          labels: {},
          buildArgKeys: [],
        },
        values,
        { cwd: "/repository", timeoutInMs: 1000 },
      )
      .catch((error: unknown) => error);
    const runFailure = await docker
      .runContainer(
        {
          containerName: "app",
          imageTag: "nelcota/api:abc",
          network: "nelcota",
          labels: {},
          environmentKeys: [],
          volumes: [],
        },
        values,
      )
      .catch((error: unknown) => error);
    expect(buildFailure).toBeInstanceOf(InvalidDockerArgumentError);
    expect(runFailure).toBeInstanceOf(InvalidDockerArgumentError);
    expect(calls).toBe(0);
  },
);
