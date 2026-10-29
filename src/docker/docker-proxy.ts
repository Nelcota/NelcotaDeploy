import { type CommandRunner, failureReason } from "@/process";

import {
  LABELS,
  PROXY_CONTAINER_NAME,
  PROXY_VERSION,
  proxyContainerArgs,
  type ProxyOptions,
} from "./docker.commands";
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
    throw new DockerCommandError(
      `docker ${command[1] ?? ""} proxy failed: ${failureReason(result)}`,
      result.exitCode,
    );
  }
}

/**
 * Starts a server's reverse proxy (Traefik with HTTPS) unless it already runs with the
 * current settings. Its label marks it as the proxy, so the platform never mistakes it for an
 * application container.
 *
 * @remarks
 * A proxy created with older settings is replaced, which interrupts the server's sites for
 * the few seconds the new one takes to start.
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
  const format = `{{.State.Running}} {{index .Config.Labels "${LABELS.proxyVersion}"}}`;
  const inspect = await runner(
    [binary, "container", "inspect", "--format", format, PROXY_CONTAINER_NAME],
    { timeoutInMs: INSPECT_TIMEOUT_IN_MS },
  );
  const [running, version] = inspect.stdout.trim().split(" ");
  if (inspect.exitCode === 0 && version !== PROXY_VERSION) {
    await runChecked(
      runner,
      [binary, "container", "rm", "--force", PROXY_CONTAINER_NAME],
      START_TIMEOUT_IN_MS,
    );
    await runChecked(runner, [binary, ...proxyContainerArgs(options)], START_TIMEOUT_IN_MS);
    return;
  }
  if (inspect.exitCode === 0 && running === "true") {
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
