import { describe, expect, test } from "bun:test";

import type { CommandRunner, ProcessResult } from "@/process";

import { ensureProxy } from "./docker-proxy";
import { DockerCommandError } from "./docker.errors";

const OPTIONS = {
  network: "nelcota",
  httpEntrypoint: "web",
  httpsEntrypoint: "websecure",
  certResolver: "letsencrypt",
  acmeEmail: null,
  routesDirectory: "/var/lib/nelcota/routes",
};

/** Answers `container inspect` with the given state and records every command. */
function fakeDocker(state: "running" | "stopped" | "missing" | "outdated", failRun = false) {
  const commands: string[] = [];
  const reply = (exitCode: number, stdout = ""): ProcessResult => ({
    exitCode,
    stdout,
    stderr: exitCode === 0 ? "" : "Error: boom",
    timedOut: false,
    aborted: false,
  });
  const inspectReplies = {
    running: reply(0, "true 2\n"),
    stopped: reply(0, "false 2\n"),
    // Proxies created before route files carry no version label.
    outdated: reply(0, "true <no value>\n"),
    missing: reply(1),
  };
  const runner: CommandRunner = async (command) => {
    commands.push(command.slice(1, 3).join(" "));
    if (command[2] === "inspect") {
      return await Promise.resolve(inspectReplies[state]);
    }
    return await Promise.resolve(reply(failRun ? 1 : 0));
  };
  return { runner, commands };
}

describe("ensureProxy", () => {
  test("does nothing while the proxy runs", async () => {
    const docker = fakeDocker("running");

    await ensureProxy(docker.runner, "docker", OPTIONS);

    expect(docker.commands).toEqual(["container inspect"]);
  });

  test("starts a stopped proxy instead of creating another one", async () => {
    const docker = fakeDocker("stopped");

    await ensureProxy(docker.runner, "docker", OPTIONS);

    expect(docker.commands).toEqual(["container inspect", "container start"]);
  });

  test("creates the proxy when it does not exist", async () => {
    const docker = fakeDocker("missing");

    await ensureProxy(docker.runner, "docker", OPTIONS);

    expect(docker.commands).toEqual(["container inspect", "run --detach"]);
  });

  test("replaces a proxy created with older settings", async () => {
    const docker = fakeDocker("outdated");

    await ensureProxy(docker.runner, "docker", OPTIONS);

    expect(docker.commands).toEqual(["container inspect", "container rm", "run --detach"]);
  });

  test("throws DockerCommandError when docker cannot create it", async () => {
    const docker = fakeDocker("missing", true);

    const error = await ensureProxy(docker.runner, "docker", OPTIONS).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DockerCommandError);
  });
});
