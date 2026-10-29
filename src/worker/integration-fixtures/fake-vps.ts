import { runProcess } from "@/process";

import type { Cleanup } from "./fixture-host";

const SETUP_TIMEOUT_IN_MS = 300_000;
const COMMAND_TIMEOUT_IN_MS = 30_000;
const POLL_INTERVAL_IN_MS = 1000;
const FIRST_PORT = 23_000;
const PORT_RANGE = 1000;

/**
 * Which bare server to simulate: Alpine already running Docker (fast), or Debian or Ubuntu
 * with only sshd, where the install command itself installs Docker like on a fresh VPS.
 */
export type VpsFlavor = "alpine" | "debian" | "ubuntu";

const IMAGES: Record<VpsFlavor, string> = {
  alpine: "docker:29-dind",
  debian: "debian:12",
  ubuntu: "ubuntu:24.04",
};
const PORT_OFFSETS: Record<VpsFlavor, number> = { alpine: 0, debian: 1000, ubuntu: 2000 };

// Neither image runs systemd, so systemctl is a stand-in that reloads sshd like systemd would.
const FAKE_SYSTEMCTL = String.raw`printf '#!/bin/sh\nkill -HUP "$(cat /run/sshd.pid 2>/dev/null || cat /var/run/sshd.pid)"\n' > /usr/local/bin/systemctl
chmod +x /usr/local/bin/systemctl`;

// Docker already runs; sshd and nothing of the panel yet.
const ALPINE_BOOT_SCRIPT = `
set -e
apk add --no-cache openssh git shadow procps >/dev/null
ssh-keygen -A >/dev/null
getent group docker >/dev/null || addgroup docker
${FAKE_SYSTEMCTL}
dockerd --group docker >/var/log/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 1; done
/usr/sbin/sshd
touch /ready
exec sleep infinity
`;

// A fresh Debian or Ubuntu VPS: only sshd. The install command installs Docker and git.
const APT_BOOT_SCRIPT = `
set -e
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server curl ca-certificates procps >/dev/null
mkdir -p /run/sshd
${FAKE_SYSTEMCTL}
/usr/sbin/sshd
touch /ready
exec sleep infinity
`;

const BOOT_SCRIPTS: Record<VpsFlavor, string> = {
  alpine: ALPINE_BOOT_SCRIPT,
  debian: APT_BOOT_SCRIPT,
  ubuntu: APT_BOOT_SCRIPT,
};

/** A throwaway server reached over SSH, as a privileged container. */
export type FakeVps = {
  readonly container: string;
  readonly sshPort: number;
  /** Shell root uses on this distribution, which runs the command pasted from the panel. */
  readonly rootShell: string;
  /** Runs a command inside the server as root. */
  readonly exec: (command: readonly string[], stdin?: string) => Promise<string>;
  /**
   * Starts Docker when the install command installed it: without systemd nothing starts the
   * daemon, which a real VPS does on its own.
   */
  readonly startDocker: () => Promise<void>;
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
 * Boots a fake VPS with sshd, and registers its removal.
 *
 * @param cleanups - Receives the removal of the container.
 * @param flavor - Distribution to simulate.
 * @returns The server.
 */
export async function startFakeVps(cleanups: Cleanup[], flavor: VpsFlavor): Promise<FakeVps> {
  const container = `nelcota-vps-it-${flavor}-${process.pid}`;
  const sshPort = FIRST_PORT + PORT_OFFSETS[flavor] + (process.pid % PORT_RANGE);
  await docker([
    "run",
    "--detach",
    "--privileged",
    "--name",
    container,
    "--publish",
    `127.0.0.1:${sshPort}:22`,
    // Docker's own storage cannot sit on the container's overlay filesystem; the dind image
    // declares this volume itself, Debian and Ubuntu need it here.
    "--volume",
    "/var/lib/docker",
    "--entrypoint",
    "sh",
    IMAGES[flavor],
    "-c",
    BOOT_SCRIPTS[flavor],
  ]);
  cleanups.push(async () => {
    await runProcess(["docker", "rm", "--force", "--volumes", container], {
      timeoutInMs: SETUP_TIMEOUT_IN_MS,
    });
  });
  await waitUntilBooted(container, Date.now() + SETUP_TIMEOUT_IN_MS);
  const exec = async (command: readonly string[], stdin?: string): Promise<string> =>
    await docker(["exec", ...(stdin == null ? [] : ["-i"]), container, ...command], stdin);
  return {
    container,
    sshPort,
    rootShell: flavor === "alpine" ? "sh" : "bash",
    exec,
    startDocker: async () => {
      if (flavor === "alpine") {
        return;
      }
      await exec(["sh", "-c", "dockerd >/var/log/dockerd.log 2>&1 &"]);
      await exec(["sh", "-c", "until docker info >/dev/null 2>&1; do sleep 1; done"]);
    },
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
