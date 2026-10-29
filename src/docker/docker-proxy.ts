import type { CommandRunner } from "@/process";

import { PROXY_CONTAINER_NAME, proxyContainerArgs, type ProxyOptions } from "./docker.commands";
import { DockerCommandError } from "./docker.errors";

const INSPECT_TIMEOUT_IN_MS = 30_000;
// Pulling the proxy image on a fresh server can take a while.
const START_TIMEOUT_IN_MS = 300_000;

async function runChecked(
  runner: CommandRunner,
  command: readonly string[],
  timeoutInMs: number,
): Promise<void> {
  const result = await runner(command, { timeoutInMs });
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new DockerCommandError(
      `docker ${command[1] ?? ""} proxy failed: ${reason}`,
      result.exitCode,
    );
  }
}

/**
 * Starts a server's reverse proxy (Traefik with HTTPS) unless it already runs. Its label
 * marks it as the proxy, so the platform never mistakes it for an application container.
 *
 * @param runner - Reaches the server.
 * @param binary - Docker CLI executable on that server.
 * @param options - Network, entrypoints and Let's Encrypt settings.
 * @throws {DockerCommandError} When docker fails.
 */
export async function ensureProxy(
  runner: CommandRunner,
  binary: string,
  options: ProxyOptions,
): Promise<void> {
  const inspect = await runner(
    [binary, "container", "inspect", "--format", "{{.State.Running}}", PROXY_CONTAINER_NAME],
    { timeoutInMs: INSPECT_TIMEOUT_IN_MS },
  );
  if (inspect.exitCode === 0 && inspect.stdout.trim() === "true") {
    return;
  }
  if (inspect.exitCode === 0) {
    await runChecked(
      runner,
      [binary, "container", "start", PROXY_CONTAINER_NAME],
      START_TIMEOUT_IN_MS,
    );
    return;
  }
  await runChecked(runner, [binary, ...proxyContainerArgs(options)], START_TIMEOUT_IN_MS);
}
