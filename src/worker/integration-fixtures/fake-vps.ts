import { runProcess } from "@/process";

import type { Cleanup } from "./fixture-host";

const SETUP_TIMEOUT_IN_MS = 300_000;
const COMMAND_TIMEOUT_IN_MS = 30_000;
const POLL_INTERVAL_IN_MS = 1000;
const FIRST_PORT = 23_000;
const PORT_RANGE = 1000;

// A bare VPS: Docker (in Docker), sshd and nothing of the panel yet. The install command the
// panel shows runs on it later. systemctl is a stand-in that reloads sshd like systemd would.
const BOOT_SCRIPT = `
set -e
apk add --no-cache openssh git shadow procps >/dev/null
ssh-keygen -A >/dev/null
getent group docker >/dev/null || addgroup docker
printf '#!/bin/sh\\nkill -HUP "$(cat /var/run/sshd.pid)"\\n' > /usr/local/bin/systemctl
chmod +x /usr/local/bin/systemctl
dockerd --group docker >/var/log/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 1; done
/usr/sbin/sshd
touch /ready
exec sleep infinity
`;

/** A throwaway server reached over SSH, as a privileged Docker-in-Docker container. */
export type FakeVps = {
  readonly container: string;
  readonly sshPort: number;
  /** Runs a command inside the server as root. */
  readonly exec: (command: readonly string[], stdin?: string) => Promise<string>;
};

async function docker(args: readonly string[], stdin?: string): Promise<string> {
  const child = Bun.spawn(["docker", ...args], {
    stdin: stdin == null ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: SETUP_TIMEOUT_IN_MS,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${stderr}${stdout}`);
  }
  return stdout;
}

async function waitUntilBooted(container: string, deadline: number): Promise<void> {
  if (Date.now() >= deadline) {
    throw new Error(`Fake VPS ${container} did not boot`);
  }
  const check = await runProcess(["docker", "exec", container, "test", "-f", "/ready"], {
    timeoutInMs: COMMAND_TIMEOUT_IN_MS,
  });
  if (check.exitCode === 0) {
    return;
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitUntilBooted(container, deadline);
}

/**
 * Boots a fake VPS with Docker and sshd, and registers its removal.
 *
 * @param cleanups - Receives the removal of the container.
 * @returns The server.
 */
export async function startFakeVps(cleanups: Cleanup[]): Promise<FakeVps> {
  const container = `nelcota-vps-it-${process.pid}`;
  const sshPort = FIRST_PORT + (process.pid % PORT_RANGE);
  await docker([
    "run",
    "--detach",
    "--privileged",
    "--name",
    container,
    "--publish",
    `127.0.0.1:${sshPort}:22`,
    "--entrypoint",
    "sh",
    "docker:29-dind",
    "-c",
    BOOT_SCRIPT,
  ]);
  cleanups.push(async () => {
    await runProcess(["docker", "rm", "--force", "--volumes", container], {
      timeoutInMs: SETUP_TIMEOUT_IN_MS,
    });
  });
  await waitUntilBooted(container, Date.now() + SETUP_TIMEOUT_IN_MS);
  return {
    container,
    sshPort,
    exec: async (command, stdin) =>
      await docker(["exec", ...(stdin == null ? [] : ["-i"]), container, ...command], stdin),
  };
}

/**
 * Copies a local git repository into the server, owned by the account the panel uses, so it
 * can be cloned there with a file:// URL.
 *
 * @param vps - Fake server.
 * @param repository - Local repository path.
 * @param owner - Account that clones it.
 * @returns The path inside the server.
 */
export async function copyRepositoryInto(
  vps: FakeVps,
  repository: string,
  owner: string,
): Promise<string> {
  const target = "/srv/fixture";
  await docker(["cp", repository, `${vps.container}:${target}`]);
  await vps.exec(["chown", "-R", `${owner}:${owner}`, target]);
  return target;
}
